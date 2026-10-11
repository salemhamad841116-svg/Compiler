import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Localization Provider for dynamic JSON-based i18n
/// Strict zero-Arabic source code compliance: all Arabic text is fetched from assets/i18n/
class LocalizationProvider extends ChangeNotifier {
  String _currentLocale = 'ar';
  Map<String, dynamic> _localizedStrings = {};
  bool _isLoaded = false;

  String get currentLocale => _currentLocale;
  bool get isRtl => _currentLocale == 'ar';
  bool get isLoaded => _isLoaded;
  TextDirection get textDirection => isRtl ? TextDirection.rtl : TextDirection.ltr;

  LocalizationProvider() {
    loadLocale(_currentLocale);
  }

  Future<void> loadLocale(String locale) async {
    _currentLocale = locale;
    try {
      final jsonString = await rootBundle.loadString('assets/i18n/$locale.json');
      _localizedStrings = json.decode(jsonString) as Map<String, dynamic>;
      _isLoaded = true;
    } catch (e) {
      debugPrint('[LocalizationProvider] Error loading locale $locale: $e');
      _localizedStrings = {};
    }
    notifyListeners();
  }

  String tr(String key, [String fallback = '']) {
    if (_localizedStrings.containsKey(key)) {
      return _localizedStrings[key].toString();
    }
    return fallback.isNotEmpty ? fallback : key;
  }

  Future<void> toggleLocale() async {
    final next = _currentLocale == 'ar' ? 'en' : 'ar';
    await loadLocale(next);
  }
}
