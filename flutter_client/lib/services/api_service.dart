import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import '../config/api_config.dart';
import '../models/book_item.dart';
import '../models/category_item.dart';
import '../models/source_citation.dart';

class ApiService {
  final http.Client _client;

  ApiService({http.Client? client}) : _client = client ?? http.Client();

  Future<bool> checkHealth() async {
    try {
      final response = await _client
          .get(Uri.parse(ApiConfig.healthEndpoint))
          .timeout(ApiConfig.connectTimeout);

      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  /// Fetches the dynamic list of categories from the backend
  Future<List<CategoryItem>> getCategories() async {
    try {
      final url = Uri.parse(ApiConfig.categoriesEndpoint);
      final response = await _client.get(url).timeout(ApiConfig.connectTimeout);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final list = data['data'] as List<dynamic>? ?? [];
        return list.map((item) => CategoryItem.fromJson(item as Map<String, dynamic>)).toList();
      } else {
        throw Exception('Failed to load categories (${response.statusCode})');
      }
    } catch (e) {
      throw Exception('Error fetching categories: $e');
    }
  }

  Future<Map<String, dynamic>> sendChatQuery(
    String question, {
    int topK = 5,
    double minSimilarity = 0.5,
    String? category,
    String? language,
  }) async {
    try {
      final url = Uri.parse(ApiConfig.chatQueryEndpoint);
      final body = jsonEncode({
        'question': question,
        'topK': topK,
        'minSimilarity': minSimilarity,
        if (category != null && category.isNotEmpty) 'category': category,
        if (language != null && language.isNotEmpty) 'language': language,
      });

      final response = await _client
          .post(
            url,
            headers: {'Content-Type': 'application/json'},
            body: body,
          )
          .timeout(ApiConfig.receiveTimeout);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final answer = data['answer'] as String? ?? 'No response received.';
        final rawSources = data['sources'] as List<dynamic>? ?? [];

        final sources = rawSources
            .map((s) => SourceCitation.fromJson(s as Map<String, dynamic>))
            .toList();

        return {
          'success': true,
          'answer': answer,
          'sources': sources,
        };
      } else {
        final errorData = jsonDecode(response.body);
        final errorMessage = errorData['error'] ?? 'Server error (${response.statusCode})';
        throw Exception(errorMessage);
      }
    } catch (e) {
      throw Exception('Failed to communicate with RAG assistant: $e');
    }
  }

  /// Uploads document file (.pdf, .txt, .md) to Data Vault and vector pipeline
  Future<Map<String, dynamic>> uploadBook({
    required String filePath,
    String? customTitle,
    String? supervisorId,
    String category = 'General',
    String language = 'Arabic',
    int? chunkSize,
    int? chunkOverlap,
  }) async {
    try {
      final url = Uri.parse(ApiConfig.uploadBookEndpoint);
      final request = http.MultipartRequest('POST', url);

      final file = File(filePath);
      if (!file.existsSync()) {
        throw Exception('Selected file does not exist.');
      }

      final lowerPath = filePath.toLowerCase();
      MediaType mediaType = MediaType('application', 'pdf');
      if (lowerPath.endsWith('.txt')) {
        mediaType = MediaType('text', 'plain');
      } else if (lowerPath.endsWith('.md')) {
        mediaType = MediaType('text', 'markdown');
      } else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) {
        mediaType = MediaType('image', 'jpeg');
      } else if (lowerPath.endsWith('.png')) {
        mediaType = MediaType('image', 'png');
      } else if (lowerPath.endsWith('.webp')) {
        mediaType = MediaType('image', 'webp');
      }

      final multipartFile = await http.MultipartFile.fromPath(
        'bookFile',
        filePath,
        contentType: mediaType,
      );
      request.files.add(multipartFile);

      if (customTitle != null && customTitle.trim().isNotEmpty) {
        request.fields['title'] = customTitle.trim();
      }
      if (supervisorId != null && supervisorId.trim().isNotEmpty) {
        request.fields['uploadedBy'] = supervisorId.trim();
        request.headers['X-Supervisor-ID'] = supervisorId.trim();
      }
      request.fields['category'] = category.trim().isEmpty ? 'General' : category.trim();
      request.fields['language'] = language.trim().isEmpty ? 'Arabic' : language.trim();
      if (chunkSize != null) request.fields['chunkSize'] = chunkSize.toString();
      if (chunkOverlap != null) request.fields['chunkOverlap'] = chunkOverlap.toString();

      final streamedResponse = await request.send().timeout(ApiConfig.receiveTimeout);
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        String errMsg = 'Upload failed (${response.statusCode})';
        try {
          final errorData = jsonDecode(response.body);
          if (errorData is Map && errorData.containsKey('error')) {
            errMsg = errorData['error'].toString();
          }
        } catch (_) {
          if (response.body.isNotEmpty) errMsg = response.body;
        }
        throw Exception(errMsg);
      }
    } catch (e) {
      throw Exception('Failed to upload and archive document: $e');
    }
  }

  /// Submits raw text to Data Vault as .txt file and indexes chunks
  Future<Map<String, dynamic>> uploadRawText({
    required String title,
    required String textContent,
    String? supervisorId,
    String category = 'General',
    String language = 'Arabic',
    int? chunkSize,
    int? chunkOverlap,
  }) async {
    try {
      final url = Uri.parse(ApiConfig.rawTextEndpoint);
      final body = jsonEncode({
        'title': title,
        'textContent': textContent,
        if (supervisorId != null) 'uploadedBy': supervisorId,
        'category': category.trim().isEmpty ? 'General' : category.trim(),
        'language': language.trim().isEmpty ? 'Arabic' : language.trim(),
        if (chunkSize != null) 'chunkSize': chunkSize,
        if (chunkOverlap != null) 'chunkOverlap': chunkOverlap,
      });

      final response = await _client
          .post(
            url,
            headers: {
              'Content-Type': 'application/json',
              if (supervisorId != null) 'X-Supervisor-ID': supervisorId,
            },
            body: body,
          )
          .timeout(ApiConfig.receiveTimeout);

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        final errorData = jsonDecode(response.body);
        throw Exception(errorData['error'] ?? 'Raw text indexing failed (${response.statusCode})');
      }
    } catch (e) {
      throw Exception('Failed to index raw text: $e');
    }
  }

  /// Uploads Video/Audio file for Gemini Speech-to-Text transcription and Data Vault archival
  Future<Map<String, dynamic>> uploadMediaFile({
    required String filePath,
    required String title,
    String? supervisorId,
    String category = 'General',
    String language = 'Arabic',
    int? chunkSize,
    int? chunkOverlap,
  }) async {
    try {
      final url = Uri.parse(ApiConfig.mediaUploadEndpoint);
      final request = http.MultipartRequest('POST', url);

      final file = File(filePath);
      if (!file.existsSync()) {
        throw Exception('Selected media file does not exist.');
      }

      final ext = filePath.split('.').last.toLowerCase();
      MediaType mediaType = MediaType('video', 'mp4');
      if (['mp3', 'wav', 'm4a', 'ogg'].contains(ext)) {
        mediaType = MediaType('audio', ext);
      } else if (['webm', 'mov', 'mp4'].contains(ext)) {
        mediaType = MediaType('video', ext);
      }

      final multipartFile = await http.MultipartFile.fromPath(
        'mediaFile',
        filePath,
        contentType: mediaType,
      );
      request.files.add(multipartFile);

      request.fields['title'] = title.trim();
      if (supervisorId != null && supervisorId.trim().isNotEmpty) {
        request.fields['uploadedBy'] = supervisorId.trim();
        request.headers['X-Supervisor-ID'] = supervisorId.trim();
      }
      request.fields['category'] = category.trim().isEmpty ? 'General' : category.trim();
      request.fields['language'] = language.trim().isEmpty ? 'Arabic' : language.trim();
      if (chunkSize != null) request.fields['chunkSize'] = chunkSize.toString();
      if (chunkOverlap != null) request.fields['chunkOverlap'] = chunkOverlap.toString();

      final streamedResponse = await request.send().timeout(ApiConfig.receiveTimeout);
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        final errorData = jsonDecode(response.body);
        throw Exception(errorData['error'] ?? 'Media transcription failed (${response.statusCode})');
      }
    } catch (e) {
      throw Exception('Failed to transcribe and archive media: $e');
    }
  }

  /// Scrapes web URL, archives clean text to Data Vault, and indexes chunks
  Future<Map<String, dynamic>> scrapeWebUrl({
    required String url,
    String? title,
    String? supervisorId,
    String category = 'General',
    String language = 'Arabic',
    int? chunkSize,
    int? chunkOverlap,
  }) async {
    try {
      final endpoint = Uri.parse(ApiConfig.urlScrapeEndpoint);
      final body = jsonEncode({
        'url': url,
        if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
        if (supervisorId != null) 'uploadedBy': supervisorId,
        'category': category.trim().isEmpty ? 'General' : category.trim(),
        'language': language.trim().isEmpty ? 'Arabic' : language.trim(),
        if (chunkSize != null) 'chunkSize': chunkSize,
        if (chunkOverlap != null) 'chunkOverlap': chunkOverlap,
      });

      final response = await _client
          .post(
            endpoint,
            headers: {
              'Content-Type': 'application/json',
              if (supervisorId != null) 'X-Supervisor-ID': supervisorId,
            },
            body: body,
          )
          .timeout(ApiConfig.receiveTimeout);

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else {
        final errorData = jsonDecode(response.body);
        throw Exception(errorData['error'] ?? 'URL scraping failed (${response.statusCode})');
      }
    } catch (e) {
      throw Exception('Failed to scrape web URL: $e');
    }
  }

  Future<List<BookItem>> getIndexedBooks() async {
    try {
      final url = Uri.parse(ApiConfig.booksListEndpoint);
      final response = await _client.get(url).timeout(ApiConfig.connectTimeout);

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final list = data['data'] as List<dynamic>? ?? [];
        return list.map((item) => BookItem.fromJson(item as Map<String, dynamic>)).toList();
      } else {
        throw Exception('Failed to load documents (${response.statusCode})');
      }
    } catch (e) {
      throw Exception('Error fetching indexed documents: $e');
    }
  }

  void dispose() {
    _client.close();
  }
}
