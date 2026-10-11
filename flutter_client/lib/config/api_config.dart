import 'dart:io';
import 'package:flutter/foundation.dart';

class ApiConfig {
  static String get defaultBaseUrl {
    if (kIsWeb) {
      return 'http://localhost:3000';
    }
    if (Platform.isAndroid) {
      return 'http://10.0.2.2:3000';
    }
    return 'http://localhost:3000';
  }

  static String baseUrl = defaultBaseUrl;

  // Responsive UI Breakpoints
  static const double mobileBreakpoint = 768.0;
  static const double tabletBreakpoint = 1024.0;

  // Ingestion Endpoints
  static String get chatQueryEndpoint => '$baseUrl/api/chat/query';
  static String get uploadBookEndpoint => '$baseUrl/api/ingestion/upload-book';
  static String get rawTextEndpoint => '$baseUrl/api/ingestion/raw-text';
  static String get mediaUploadEndpoint => '$baseUrl/api/ingestion/media';
  static String get urlScrapeEndpoint => '$baseUrl/api/ingestion/scrape-url';
  static String get booksListEndpoint => '$baseUrl/api/ingestion/books';
  static String get categoriesEndpoint => '$baseUrl/api/categories';
  static String get supervisorsAnalyticsEndpoint => '$baseUrl/api/admin/supervisors';
  static String get healthEndpoint => '$baseUrl/health';

  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 120); // Longer for media transcriptions
}
