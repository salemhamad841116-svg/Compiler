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
  String _activeSupervisorId = 'supervisor_ahmed@masruq.com';

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

  void setActiveSupervisor(String supervisorEmail) {
    _activeSupervisorId = supervisorEmail.trim();
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

  /// Selects and indexes a document file (.pdf, .txt, .md)
  Future<bool> pickAndUploadBook({String? customTitle, int? chunkSize, int? chunkOverlap}) async {
    try {
      _status = IngestionStatus.picking;
      _statusMessage = 'Selecting document (.PDF, .TXT, .MD)...';
      _errorMessage = null;
      notifyListeners();

      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'txt', 'md'],
      );

      if (result == null || result.files.single.path == null) {
        _status = IngestionStatus.idle;
        _statusMessage = null;
        notifyListeners();
        return false;
      }

      final filePath = result.files.single.path!;
      final originalName = result.files.single.name;
      final title = (customTitle != null && customTitle.trim().isNotEmpty)
          ? customTitle.trim()
          : originalName.replaceAll(RegExp(r'\.(pdf|txt|md)$', caseSensitive: false), '');

      _status = IngestionStatus.uploading;
      _statusMessage = 'Archiving "$title" in Data Vault & generating Gemini vectors...';
      notifyListeners();

      await _apiService.uploadBook(
        filePath: filePath,
        customTitle: title,
        supervisorId: _activeSupervisorId,
        category: _selectedCategory,
        language: _selectedLanguage,
        chunkSize: chunkSize,
        chunkOverlap: chunkOverlap,
      );

      _status = IngestionStatus.completed;
      _statusMessage = 'Successfully archived and indexed "$title"!';
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
