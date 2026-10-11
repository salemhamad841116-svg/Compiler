class SourceCitation {
  final String bookTitle;
  final double similarity;
  final String excerpt;

  SourceCitation({
    required this.bookTitle,
    required this.similarity,
    required this.excerpt,
  });

  factory SourceCitation.fromJson(Map<String, dynamic> json) {
    return SourceCitation(
      bookTitle: json['bookTitle'] as String? ?? 'Unknown Book',
      similarity: (json['similarity'] is num) ? (json['similarity'] as num).toDouble() : 0.0,
      excerpt: json['excerpt'] as String? ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'bookTitle': bookTitle,
      'similarity': similarity,
      'excerpt': excerpt,
    };
  }

  String get similarityPercentage => '${(similarity * 100).toStringAsFixed(1)}%';
}
