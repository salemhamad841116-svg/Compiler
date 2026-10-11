import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/ingestion_provider.dart';
import '../widgets/glass_container.dart';
import '../widgets/book_upload_dialog.dart';

class BooksScreen extends StatefulWidget {
  const BooksScreen({super.key});

  @override
  State<BooksScreen> createState() => _BooksScreenState();
}

class _BooksScreenState extends State<BooksScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<IngestionProvider>().fetchBooks();
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final provider = context.watch<IngestionProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Knowledge Base Books'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh Books',
            onPressed: () => provider.fetchBooks(),
          ),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: isDark
                ? [const Color(0xFF0F172A), const Color(0xFF020617)]
                : [const Color(0xFFF8FAFC), const Color(0xFFE2E8F0)],
          ),
        ),
        child: SafeArea(
          top: false,
          bottom: true,
          child: Padding(
            padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              GlassContainer(
                borderRadius: 16,
                padding: const EdgeInsets.all(18),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: theme.colorScheme.primary.withOpacity(0.15),
                      child: Icon(Icons.auto_stories_rounded, color: theme.colorScheme.primary, size: 28),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Indexed Knowledge Base',
                            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${provider.books.length} Books • ${provider.totalIndexedChunks} Vector Chunks',
                            style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey),
                          ),
                        ],
                      ),
                    ),
                    FilledButton.icon(
                      onPressed: () {
                        showDialog(
                          context: context,
                          builder: (context) => const BookUploadDialog(),
                        );
                      },
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('Upload'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'Uploaded Books (${provider.books.length})',
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 10),
              Expanded(
                child: provider.isLoadingBooks
                    ? const Center(child: CircularProgressIndicator())
                    : provider.books.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.library_books_outlined, size: 64, color: Colors.grey.withOpacity(0.5)),
                                const SizedBox(height: 12),
                                Text(
                                  'No books indexed yet.',
                                  style: theme.textTheme.titleMedium?.copyWith(color: Colors.grey),
                                ),
                                const SizedBox(height: 6),
                                const Text(
                                  'Upload a PDF document to start querying your private AI.',
                                  style: TextStyle(color: Colors.grey, fontSize: 13),
                                ),
                                const SizedBox(height: 16),
                                FilledButton.tonalIcon(
                                  onPressed: () {
                                    showDialog(
                                      context: context,
                                      builder: (context) => const BookUploadDialog(),
                                    );
                                  },
                                  icon: const Icon(Icons.upload_file),
                                  label: const Text('Upload First Book'),
                                ),
                              ],
                            ),
                          )
                        : ListView.separated(
                            itemCount: provider.books.length,
                            separatorBuilder: (context, index) => const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              final book = provider.books[index];
                              return GlassContainer(
                                borderRadius: 14,
                                padding: const EdgeInsets.all(14),
                                child: ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: CircleAvatar(
                                    backgroundColor: theme.colorScheme.secondary.withOpacity(0.15),
                                    child: Icon(Icons.book, color: theme.colorScheme.secondary),
                                  ),
                                  title: Text(
                                    book.bookTitle,
                                    style: const TextStyle(fontWeight: FontWeight.w600),
                                  ),
                                  subtitle: Text(
                                    '${book.totalChunks} indexed chunks • text-embedding-004',
                                    style: TextStyle(fontSize: 12, color: Colors.grey.shade400),
                                  ),
                                  trailing: const Icon(Icons.check_circle_outline, color: Colors.green, size: 20),
                                ),
                              );
                            },
                          ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
}
