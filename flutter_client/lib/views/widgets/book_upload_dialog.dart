import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/ingestion_provider.dart';

/// Modal dialog providing tabs to switch between uploading a document (.pdf, .txt, .md) and pasting raw text directly.
class BookUploadDialog extends StatefulWidget {
  const BookUploadDialog({super.key});

  @override
  State<BookUploadDialog> createState() => _BookUploadDialogState();
}

class _BookUploadDialogState extends State<BookUploadDialog> {
  final TextEditingController _fileTitleController = TextEditingController();
  final TextEditingController _rawTitleController = TextEditingController();
  final TextEditingController _rawTextController = TextEditingController();

  @override
  void dispose() {
    _fileTitleController.dispose();
    _rawTitleController.dispose();
    _rawTextController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ingestionProvider = context.watch<IngestionProvider>();
    final isUploading = ingestionProvider.status == IngestionStatus.uploading ||
        ingestionProvider.status == IngestionStatus.picking;

    return DefaultTabController(
      length: 2,
      child: AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 10),
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        title: Column(
          children: [
            Row(
              children: [
                Icon(Icons.layers_rounded, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
                const Text('Ingest Knowledge', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 12),
            TabBar(
              labelColor: Theme.of(context).colorScheme.primary,
              unselectedLabelColor: Colors.grey,
              indicatorColor: Theme.of(context).colorScheme.primary,
              tabs: const [
                Tab(icon: Icon(Icons.file_upload_outlined, size: 18), text: 'Upload File'),
                Tab(icon: Icon(Icons.paste_rounded, size: 18), text: 'Paste Raw Text'),
              ],
            ),
          ],
        ),
        content: SizedBox(
          width: 500,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  height: 280,
                  child: TabBarView(
                    children: [
                      // Tab 1: Upload File (.PDF, .TXT, .MD)
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(height: 12),
                          const Text(
                            'Select a .PDF, .TXT, or .MD document to extract and index into your knowledge base.',
                            style: TextStyle(fontSize: 12.5, color: Colors.grey, height: 1.4),
                          ),
                          const SizedBox(height: 16),
                          TextField(
                            controller: _fileTitleController,
                            enabled: !isUploading,
                            decoration: InputDecoration(
                              labelText: 'Document Title (Optional)',
                              hintText: 'e.g., Strategic Leadership Notes',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                              prefixIcon: const Icon(Icons.title_rounded),
                              isDense: true,
                            ),
                          ),
                          const Spacer(),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: isUploading
                                  ? null
                                  : () async {
                                      final success = await ingestionProvider.pickAndUploadBook(
                                        customTitle: _fileTitleController.text,
                                      );
                                      if (success && mounted) {
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          const SnackBar(
                                            content: Text('Document successfully indexed!'),
                                            backgroundColor: Colors.green,
                                          ),
                                        );
                                        Navigator.of(context).pop();
                                      }
                                    },
                              icon: const Icon(Icons.folder_open_rounded, size: 18),
                              label: const Text('Choose File (.PDF, .TXT, .MD)'),
                            ),
                          ),
                        ],
                      ),

                      // Tab 2: Paste Raw Text
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(height: 12),
                          TextField(
                            controller: _rawTitleController,
                            enabled: !isUploading,
                            decoration: InputDecoration(
                              labelText: 'Title / Topic Name',
                              hintText: 'e.g., Q3 Market Strategy Summary',
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                              prefixIcon: const Icon(Icons.bookmark_outline_rounded),
                              isDense: true,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Expanded(
                            child: TextField(
                              controller: _rawTextController,
                              enabled: !isUploading,
                              maxLines: null,
                              expands: true,
                              textAlignVertical: TextAlignVertical.top,
                              decoration: InputDecoration(
                                labelText: 'Paste Content Here',
                                hintText: 'Paste articles, notes, research snippets, or text...',
                                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                                alignLabelWithHint: true,
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: isUploading
                                  ? null
                                  : () async {
                                      if (_rawTextController.text.trim().isEmpty) {
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          const SnackBar(content: Text('Please paste some text first')),
                                        );
                                        return;
                                      }
                                      final success = await ingestionProvider.ingestRawText(
                                        title: _rawTitleController.text,
                                        textContent: _rawTextController.text,
                                      );
                                      if (success && mounted) {
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          const SnackBar(
                                            content: Text('Raw text successfully indexed!'),
                                            backgroundColor: Colors.green,
                                          ),
                                        );
                                        Navigator.of(context).pop();
                                      }
                                    },
                              icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                              label: const Text('Index Raw Text'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                if (isUploading) ...[
                  const SizedBox(height: 16),
                  const LinearProgressIndicator(),
                  const SizedBox(height: 8),
                  Text(
                    ingestionProvider.statusMessage ?? 'Processing...',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic),
                  ),
                ],

                if (ingestionProvider.errorMessage != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.red.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      ingestionProvider.errorMessage!,
                      style: const TextStyle(color: Colors.redAccent, fontSize: 12),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: isUploading
                ? null
                : () {
                    ingestionProvider.resetStatus();
                    Navigator.of(context).pop();
                  },
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}
