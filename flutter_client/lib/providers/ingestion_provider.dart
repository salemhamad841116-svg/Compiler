import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../models/book_item.dart';
import '../models/category_item.dart';
import '../services/api_service.dart';

enum IngestionStatus { idle, picking, uploading, completed, error }

class IngestionProvider with ChangeNotifier {
  final ApiService _apiService;

  List<BookItem> _books = [];
  bool _isLoadingBooks = false;
  List<CategoryItem> _categories = [];
  bool _isLoadingCategories = false;
  String _selectedCategory = 'Hadith';
  String _selectedLanguage = 'Arabic';
  IngestionStatus _status = IngestionStatus.idle;
  String? _statusMessage;
  String? _errorMessage;
  String _activeSupervisorId = '';
  bool _isLoggingIn = false;
  String? _loginError;

  IngestionProvider({required ApiService apiService}) : _apiService = apiService {
    fetchCategories();
    fetchBooks();
  }

  List<BookItem> get books => List.unmodifiable(_books);
  bool get isLoadingBooks => _isLoadingBooks;
  List<CategoryItem> get categories => List.unmodifiable(_categories);
  bool get isLoadingCategories => _isLoadingCategories;
  String get selectedCategory => _selectedCategory;
  String get selectedLanguage => _selectedLanguage;
  IngestionStatus get status => _status;
  String? get statusMessage => _statusMessage;
  String? get errorMessage => _errorMessage;
  String get activeSupervisorId => _activeSupervisorId;
  int get totalIndexedChunks => _books.fold(0, (sum, b) => sum + b.totalChunks);

  bool get isAuthenticated => _apiService.isAuthenticated;
  bool get isLoggingIn => _isLoggingIn;
  String? get loginError => _loginError;

  /// Real server-side authentication (replaces the former free-text supervisor selector).
  Future<bool> login(String email, String password) async {
    _isLoggingIn = true;
    _loginError = null;
    notifyListeners();
    try {
      await _apiService.login(email, password);
      _activeSupervisorId = _apiService.currentUserEmail ?? email.trim();
      await fetchCategories();
      await fetchBooks();
      return true;
    } catch (e) {
      _loginError = e.toString().replaceFirst('Exception: ', '');
      return false;
    } finally {
      _isLoggingIn = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await _apiService.logout();
    _activeSupervisorId = '';
    _books = [];
    notifyListeners();
  }

  void setSelectedCategory(String category) {
    _selectedCategory = category;
    notifyListeners();
  }

  void setSelectedLanguage(String language) {
    _selectedLanguage = language;
    notifyListeners();
  }

  Future<void> fetchCategories() async {
    _isLoadingCategories = true;
    notifyListeners();

    try {
      final fetched = await _apiService.getCategories();
      if (fetched.isNotEmpty) {
        _categories = fetched;
        if (!_categories.any((c) => c.name == _selectedCategory)) {
          _selectedCategory = _categories.first.name;
        }
      }
    } catch (e) {
      debugPrint('[IngestionProvider] Error fetching dynamic categories: $e');
    } finally {
      _isLoadingCategories = false;
      notifyListeners();
    }
  }

  Future<void> fetchBooks() async {
    _isLoadingBooks = true;
    notifyListeners();

    try {
      _books = await _apiService.getIndexedBooks();
      _errorMessage = null;
    } catch (e) {
      _errorMessage = e.toString();
    } finally {
      _isLoadingBooks = false;
      notifyListeners();
    }
  }

  /// Selects and indexes document or image files (.pdf, .txt, .md, .jpg, .png, .webp) with bulk support
  Future<bool> pickAndUploadBook({String? customTitle, int? chunkSize, int? chunkOverlap}) async {
    try {
      _status = IngestionStatus.picking;
      _statusMessage = 'Selecting documents or images...';
      _errorMessage = null;
      notifyListeners();

      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'txt', 'md', 'jpg', 'jpeg', 'png', 'webp'],
        allowMultiple: true,
      );

      if (result == null || result.files.isEmpty) {
        _status = IngestionStatus.idle;
        _statusMessage = null;
        notifyListeners();
        return false;
      }

      final validFiles = result.files.where((f) => f.path != null).toList();
      if (validFiles.isEmpty) {
        _status = IngestionStatus.idle;
        _statusMessage = null;
        notifyListeners();
        return false;
      }

      _status = IngestionStatus.uploading;
      int successCount = 0;
      int failCount = 0;

      for (int i = 0; i < validFiles.length; i++) {
        final f = validFiles[i];
        final filePath = f.path!;
        final originalName = f.name;
        final title = (validFiles.length == 1 && customTitle != null && customTitle.trim().isNotEmpty)
            ? customTitle.trim()
            : originalName.replaceAll(RegExp(r'\.[a-zA-Z0-9]+$', caseSensitive: false), '');

        _statusMessage = 'Processing ${i + 1}/${validFiles.length}: "$title"...';
        notifyListeners();

        try {
          await _apiService.uploadBook(
            filePath: filePath,
            customTitle: title,
            supervisorId: _activeSupervisorId,
            category: _selectedCategory,
            language: _selectedLanguage,
            chunkSize: chunkSize,
            chunkOverlap: chunkOverlap,
          );
          successCount++;
        } catch (fileErr) {
          debugPrint('[IngestionProvider] File upload error on $originalName: $fileErr');
          failCount++;
        }
      }

      await fetchBooks();

      if (failCount == 0) {
        _status = IngestionStatus.completed;
        _statusMessage = 'Successfully uploaded and indexed $successCount files!';
        notifyListeners();
        return true;
      } else {
        _status = IngestionStatus.completed;
        _statusMessage = 'Batch finished: $successCount succeeded, $failCount failed.';
        notifyListeners();
        return successCount > 0;
      }
    } catch (e) {
      _status = IngestionStatus.error;
      _errorMessage = e.toString().replaceAll('Exception: ', '');
      _statusMessage = null;
      notifyListeners();
      return false;
    }
  }

  /// Indexes raw text directly and saves .txt file into Data Vault
  Future<bool> ingestRawText({
    required String title,
    required String textContent,
    int? chunkSize,
    int? chunkOverlap,
  }) async {
    try {
      final trimmedTitle = title.trim().isEmpty ? 'Pasted Note' : title.trim();
      final trimmedContent = textContent.trim();

      if (trimmedContent.isEmpty) {
        throw Exception('Text content cannot be empty.');
      }

      _status = IngestionStatus.uploading;
      _statusMessage = 'Saving .TXT in Data Vault and generating embeddings for "$trimmedTitle"...';
      _errorMessage = null;
      notifyListeners();

      await _apiService.uploadRawText(
        title: trimmedTitle,
        textContent: trimmedContent,
        supervisorId: _activeSupervisorId,
        category: _selectedCategory,
        language: _selectedLanguage,
        chunkSize: chunkSize,
        chunkOverlap: chunkOverlap,
      );

      _status = IngestionStatus.completed;
      _statusMessage = 'Successfully indexed "$trimmedTitle"!';
      await fetchBooks();
      notifyListeners();
      return true;
    } catch (e) {
      _status = IngestionStatus.error;
      _errorMessage = e.toString().replaceAll('Exception: ', '');
      _statusMessage = null;
      notifyListeners();
      return false;
    }
  }

  /// Selects and transcribes a Video/Audio file using Gemini Speech-to-Text
  Future<bool> pickAndUploadMedia({required String title, int? chunkSize, int? chunkOverlap}) async {
    try {
      _status = IngestionStatus.picking;
      _statusMessage = 'Selecting Video/Audio file...';
      _errorMessage = null;
      notifyListeners();

      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['mp4', 'mp3', 'wav', 'm4a', 'ogg', 'webm', 'mov'],
      );

      if (result == null || result.files.single.path == null) {
        _status = IngestionStatus.idle;
        _statusMessage = null;
        notifyListeners();
        return false;
      }

      final filePath = result.files.single.path!;
      final originalName = result.files.single.name;
      final mediaTitle = title.trim().isNotEmpty ? title.trim() : originalName;

      _status = IngestionStatus.uploading;
      _statusMessage = 'Transcribing speech via Gemini multimodal engine & archiving media...';
      notifyListeners();

      await _apiService.uploadMediaFile(
        filePath: filePath,
        title: mediaTitle,
        supervisorId: _activeSupervisorId,
        category: _selectedCategory,
        language: _selectedLanguage,
        chunkSize: chunkSize,
        chunkOverlap: chunkOverlap,
      );

      _status = IngestionStatus.completed;
      _statusMessage = 'Successfully transcribed and indexed media "$mediaTitle"!';
      await fetchBooks();
      notifyListeners();
      return true;
    } catch (e) {
      _status = IngestionStatus.error;
      _errorMessage = e.toString().replaceAll('Exception: ', '');
      _statusMessage = null;
      notifyListeners();
      return false;
    }
  }

  /// Scrapes a web URL, archives clean text to Data Vault, and indexes vectors
  Future<bool> scrapeAndIngestUrl({
    required String url,
    String? title,
    int? chunkSize,
    int? chunkOverlap,
  }) async {
    try {
      if (url.trim().isEmpty) {
        throw Exception('Please enter a valid web URL.');
      }

      _status = IngestionStatus.uploading;
      _statusMessage = 'Scraping web article, archiving to Data Vault & generating embeddings...';
      _errorMessage = null;
      notifyListeners();

      await _apiService.scrapeWebUrl(
        url: url.trim(),
        title: title,
        supervisorId: _activeSupervisorId,
        category: _selectedCategory,
        language: _selectedLanguage,
        chunkSize: chunkSize,
        chunkOverlap: chunkOverlap,
      );

      _status = IngestionStatus.completed;
      _statusMessage = 'Successfully scraped and indexed URL content!';
      await fetchBooks();
      notifyListeners();
      return true;
    } catch (e) {
      _status = IngestionStatus.error;
      _errorMessage = e.toString().replaceAll('Exception: ', '');
      _statusMessage = null;
      notifyListeners();
      return false;
    }
  }

  void resetStatus() {
    _status = IngestionStatus.idle;
    _statusMessage = null;
    _errorMessage = null;
    notifyListeners();
  }
}
