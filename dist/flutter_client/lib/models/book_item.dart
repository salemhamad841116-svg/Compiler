class BookItem {
  final String bookTitle;
  final int totalChunks;
  final int totalPages;
  final String category;
  final String language;
  final String? uploadedBy;
  final String? uploadType;
  final String? sourceType;
  final String? rawFileUrl;
  final String? uploadedAt;

  BookItem({
    required this.bookTitle,
    required this.totalChunks,
    this.totalPages = 1,
    this.category = 'General',
    this.language = 'Arabic',
    this.uploadedBy,
    this.uploadType,
    this.sourceType,
    this.rawFileUrl,
    this.uploadedAt,
  });

  factory BookItem.fromJson(Map<String, dynamic> json) {
    return BookItem(
      bookTitle: json['bookTitle'] as String? ?? 'Untitled Book',
      totalChunks: json['totalChunks'] as int? ?? 0,
      totalPages: json['totalPages'] as int? ?? 1,
      category: json['category'] as String? ?? 'General',
      language: json['language'] as String? ?? 'Arabic',
      uploadedBy: json['uploadedBy'] as String?,
      uploadType: json['uploadType'] as String?,
      sourceType: json['sourceType'] as String?,
      rawFileUrl: json['rawFileUrl'] as String?,
      uploadedAt: json['uploadedAt'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'bookTitle': bookTitle,
      'totalChunks': totalChunks,
      'totalPages': totalPages,
      'category': category,
      'language': language,
      if (uploadedBy != null) 'uploadedBy': uploadedBy,
      if (uploadType != null) 'uploadType': uploadType,
      if (sourceType != null) 'sourceType': sourceType,
      if (rawFileUrl != null) 'rawFileUrl': rawFileUrl,
      if (uploadedAt != null) 'uploadedAt': uploadedAt,
    };
  }
}
