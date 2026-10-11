class CategoryItem {
  final String id;
  final String name;
  final String? description;

  CategoryItem({
    required this.id,
    required this.name,
    this.description,
  });

  factory CategoryItem.fromJson(Map<String, dynamic> json) {
    return CategoryItem(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? 'General',
      description: json['description'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      if (description != null) 'description': description,
    };
  }
}
