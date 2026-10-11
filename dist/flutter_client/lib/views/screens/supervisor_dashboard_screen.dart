import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../config/api_config.dart';
import '../../providers/ingestion_provider.dart';
import '../widgets/glass_container.dart';

/// Responsive Supervisor Dashboard Screen supporting Desktop (Sidebar) and Mobile (Bottom Bar) layouts.
class SupervisorDashboardScreen extends StatefulWidget {
  const SupervisorDashboardScreen({super.key});

  @override
  State<SupervisorDashboardScreen> createState() => _SupervisorDashboardScreenState();
}

class _SupervisorDashboardScreenState extends State<SupervisorDashboardScreen> {
  int _selectedTabIndex = 0;

  // Controllers for Tab 1: Document Upload
  final TextEditingController _docTitleController = TextEditingController();

  // Controllers for Tab 2: Raw Text
  final TextEditingController _rawTitleController = TextEditingController();
  final TextEditingController _rawContentController = TextEditingController();

  // Controllers for Tab 3: Media Speech-to-Text
  final TextEditingController _mediaTitleController = TextEditingController();

  // Controllers for Tab 4: URL Scraper
  final TextEditingController _urlInputController = TextEditingController();
  final TextEditingController _urlTitleController = TextEditingController();

  final List<String> _supervisorList = [
    'supervisor_ahmed@masruq.com',
    'supervisor_fatima@masruq.com',
    'supervisor_omar@masruq.com',
  ];

  @override
  void dispose() {
    _docTitleController.dispose();
    _rawTitleController.dispose();
    _rawContentController.dispose();
    _mediaTitleController.dispose();
    _urlInputController.dispose();
    _urlTitleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final ingestionProvider = context.watch<IngestionProvider>();

    return LayoutBuilder(
      builder: (context, constraints) {
        final isDesktop = constraints.maxWidth >= ApiConfig.mobileBreakpoint;

        return Scaffold(
          appBar: AppBar(
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF10B981).withOpacity(0.2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.edit_document, color: Color(0xFF10B981), size: 18),
                ),
                const SizedBox(width: 8),
                const Text('Supervisor Ingestion Hub', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ],
            ),
            actions: [
              // Supervisor Selector Dropdown
              Padding(
                padding: const EdgeInsets.only(right: 12.0),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: _supervisorList.contains(ingestionProvider.activeSupervisorId)
                        ? ingestionProvider.activeSupervisorId
                        : _supervisorList.first,
                    dropdownColor: isDark ? const Color(0xFF0F172A) : Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    items: _supervisorList.map((email) {
                      return DropdownMenuItem<String>(
                        value: email,
                        child: Row(
                          children: [
                            const Icon(Icons.person_pin, size: 16, color: Color(0xFF10B981)),
                            const SizedBox(width: 6),
                            Text(
                              isDesktop ? email : email.split('@').first,
                              style: const TextStyle(fontSize: 12.5),
                            ),
                          ],
                        ),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) {
                        ingestionProvider.setActiveSupervisor(val);
                      }
                    },
                  ),
                ),
              ),
            ],
          ),
          body: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: isDark
                    ? [const Color(0xFF070B14), const Color(0xFF0F172A)]
                    : [const Color(0xFFF8FAFC), const Color(0xFFE2E8F0)],
              ),
            ),
            child: isDesktop
                ? _buildDesktopLayout(context, ingestionProvider)
                : _buildMobileLayout(context, ingestionProvider),
          ),
          // Mobile Thumb-Friendly Bottom Navigation Bar
          bottomNavigationBar: isDesktop
              ? null
              : NavigationBar(
                  selectedIndex: _selectedTabIndex,
                  onDestinationSelected: (idx) {
                    setState(() {
                      _selectedTabIndex = idx;
                    });
                  },
                  destinations: const [
                    NavigationDestination(
                      icon: Icon(Icons.file_upload_outlined),
                      selectedIcon: Icon(Icons.file_upload),
                      label: 'Doc File',
                    ),
                    NavigationDestination(
                      icon: Icon(Icons.paste_outlined),
                      selectedIcon: Icon(Icons.paste),
                      label: 'Raw Text',
                    ),
                    NavigationDestination(
                      icon: Icon(Icons.mic_none_rounded),
                      selectedIcon: Icon(Icons.mic_rounded),
                      label: 'Speech/Audio',
                    ),
                    NavigationDestination(
                      icon: Icon(Icons.language_rounded),
                      selectedIcon: Icon(Icons.language),
                      label: 'Web Scraper',
                    ),
                  ],
                ),
        );
      },
    );
  }

  // 1. Desktop & Tablet Layout with Persistent Sidebar
  Widget _buildDesktopLayout(BuildContext context, IngestionProvider provider) {
    return Row(
      children: [
        // Persistent Glass Sidebar
        Container(
          width: 260,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 20),
          decoration: BoxDecoration(
            color: Colors.black.withOpacity(0.2),
            border: Border(right: BorderSide(color: Colors.white.withOpacity(0.08))),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 12.0, vertical: 8.0),
                child: Text(
                  'INGESTION MODES',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey, letterSpacing: 1),
                ),
              ),
              _buildSidebarItem(0, Icons.description_rounded, 'Document File (.PDF/.TXT)'),
              _buildSidebarItem(1, Icons.paste_rounded, 'Paste Raw Text'),
              _buildSidebarItem(2, Icons.graphic_eq_rounded, 'Video/Audio (Speech-to-Text)'),
              _buildSidebarItem(3, Icons.public_rounded, 'Web URL Scraper'),
              const Spacer(),
              // Vault Storage Badge
              GlassContainer(
                borderRadius: 12,
                padding: const EdgeInsets.all(12),
                child: const Row(
                  children: [
                    Icon(Icons.inventory_2_rounded, size: 20, color: Color(0xFF10B981)),
                    SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Data Vault Storage', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          Text('Permanent Cloud Storage', style: TextStyle(fontSize: 10, color: Colors.grey)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        // Main Desktop Form Workspace & Table
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildActiveTabForm(context, provider),
                const SizedBox(height: 28),
                _buildHistorySection(context, provider),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // 2. Mobile Layout with Thumb-Friendly Elements
  Widget _buildMobileLayout(BuildContext context, IngestionProvider provider) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildActiveTabForm(context, provider),
          const SizedBox(height: 24),
          _buildHistorySection(context, provider),
        ],
      ),
    );
  }

  Widget _buildSidebarItem(int index, IconData icon, String label) {
    final isSelected = _selectedTabIndex == index;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      child: ListTile(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        selected: isSelected,
        selectedTileColor: const Color(0xFF10B981).withOpacity(0.18),
        leading: Icon(icon, color: isSelected ? const Color(0xFF10B981) : Colors.grey, size: 20),
        title: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            color: isSelected ? Colors.white : Colors.grey,
          ),
        ),
        onTap: () {
          setState(() {
            _selectedTabIndex = index;
          });
        },
      ),
    );
  }

  Widget _buildActiveTabForm(BuildContext context, IngestionProvider provider) {
    final isUploading = provider.status == IngestionStatus.uploading || provider.status == IngestionStatus.picking;

    switch (_selectedTabIndex) {
      case 0:
        return _buildDocUploadCard(context, provider, isUploading);
      case 1:
        return _buildRawTextCard(context, provider, isUploading);
      case 2:
        return _buildMediaCard(context, provider, isUploading);
      case 3:
      default:
        return _buildUrlScraperCard(context, provider, isUploading);
    }
  }

  // Card 1: Document Upload
  Widget _buildDocUploadCard(BuildContext context, IngestionProvider provider, bool isUploading) {
    return GlassContainer(
      borderRadius: 16,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.cloud_upload_rounded, color: Color(0xFF10B981)),
              SizedBox(width: 8),
              Text('Upload Document File (.PDF, .TXT, .MD)', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 6),
          const Text('Files are permanently archived in the Data Vault and indexed via vector embeddings.', style: TextStyle(fontSize: 12.5, color: Colors.grey)),
          const SizedBox(height: 16),
          TextField(
            controller: _docTitleController,
            enabled: !isUploading,
            decoration: InputDecoration(
              labelText: 'Document Title (Optional)',
              hintText: 'e.g., Strategic Leadership Notes',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              prefixIcon: const Icon(Icons.title),
            ),
          ),
          _buildMetadataSelectorRow(context, provider, isUploading),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              onPressed: isUploading
                  ? null
                  : () async {
                      final success = await provider.pickAndUploadBook(customTitle: _docTitleController.text);
                      if (success && mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Document successfully archived & indexed!'), backgroundColor: Colors.green));
                        _docTitleController.clear();
                      }
                    },
              icon: const Icon(Icons.folder_open_rounded),
              label: const Text('Choose Document (.PDF, .TXT, .MD)'),
            ),
          ),
          if (isUploading) _buildProgressWidget(provider),
        ],
      ),
    );
  }

  // Card 2: Paste Raw Text
  Widget _buildRawTextCard(BuildContext context, IngestionProvider provider, bool isUploading) {
    return GlassContainer(
      borderRadius: 16,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.paste_rounded, color: Color(0xFF38BDF8)),
              SizedBox(width: 8),
              Text('Paste Raw Text / Notes', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 6),
          const Text('The engine automatically creates a .txt file in the Data Vault and indexes the text chunks.', style: TextStyle(fontSize: 12.5, color: Colors.grey)),
          const SizedBox(height: 16),
          TextField(
            controller: _rawTitleController,
            enabled: !isUploading,
            decoration: InputDecoration(
              labelText: 'Title / Topic Name',
              hintText: 'e.g., Q3 Market Strategy Note',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              prefixIcon: const Icon(Icons.bookmark_outline),
            ),
          ),
          _buildMetadataSelectorRow(context, provider, isUploading),
          const SizedBox(height: 14),
          TextField(
            controller: _rawContentController,
            enabled: !isUploading,
            minLines: 5,
            maxLines: 10,
            decoration: InputDecoration(
              labelText: 'Content',
              hintText: 'Paste article, lecture notes, or code snippets here...',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              onPressed: isUploading
                  ? null
                  : () async {
                      if (_rawContentController.text.trim().isEmpty) return;
                      final success = await provider.ingestRawText(
                        title: _rawTitleController.text,
                        textContent: _rawContentController.text,
                      );
                      if (success && mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Raw text archived & indexed!'), backgroundColor: Colors.green));
                        _rawTitleController.clear();
                        _rawContentController.clear();
                      }
                    },
              icon: const Icon(Icons.auto_awesome),
              label: const Text('Save to Data Vault & Index Text'),
            ),
          ),
          if (isUploading) _buildProgressWidget(provider),
        ],
      ),
    );
  }

  // Card 3: Media Speech-to-Text
  Widget _buildMediaCard(BuildContext context, IngestionProvider provider, bool isUploading) {
    return GlassContainer(
      borderRadius: 16,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.graphic_eq_rounded, color: Color(0xFFF59E0B)),
              SizedBox(width: 8),
              Text('Video / Audio Speech-to-Text', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 6),
          const Text('Transcribes speeches, lectures, or fatwas (.mp4, .mp3, .wav) verbatim via Gemini Multimodal AI.', style: TextStyle(fontSize: 12.5, color: Colors.grey)),
          const SizedBox(height: 16),
          TextField(
            controller: _mediaTitleController,
            enabled: !isUploading,
            decoration: InputDecoration(
              labelText: 'Media Title / Lecture Topic',
              hintText: 'e.g., Friday Khutbah - Financial Transparency',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              prefixIcon: const Icon(Icons.mic),
            ),
          ),
          _buildMetadataSelectorRow(context, provider, isUploading),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFF0284C7)),
              onPressed: isUploading
                  ? null
                  : () async {
                      final success = await provider.pickAndUploadMedia(title: _mediaTitleController.text);
                      if (success && mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Media transcribed & indexed!'), backgroundColor: Colors.green));
                        _mediaTitleController.clear();
                      }
                    },
              icon: const Icon(Icons.video_library_rounded),
              label: const Text('Select Media & Transcribe Speech'),
            ),
          ),
          if (isUploading) _buildProgressWidget(provider),
        ],
      ),
    );
  }

  // Card 4: Web URL Scraper
  Widget _buildUrlScraperCard(BuildContext context, IngestionProvider provider, bool isUploading) {
    return GlassContainer(
      borderRadius: 16,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.public_rounded, color: Color(0xFFEC4899)),
              SizedBox(width: 8),
              Text('Web URL Article Scraper', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 6),
          const Text('Fetches article, strips ads and navigation, saves .txt in Data Vault, and indexes text.', style: TextStyle(fontSize: 12.5, color: Colors.grey)),
          const SizedBox(height: 16),
          TextField(
            controller: _urlInputController,
            enabled: !isUploading,
            decoration: InputDecoration(
              labelText: 'Web Page URL',
              hintText: 'https://example.com/research-article',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              prefixIcon: const Icon(Icons.link),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _urlTitleController,
            enabled: !isUploading,
            decoration: InputDecoration(
              labelText: 'Custom Title (Optional)',
              hintText: 'Auto-detected from webpage if empty',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              prefixIcon: const Icon(Icons.title),
            ),
          ),
          _buildMetadataSelectorRow(context, provider, isUploading),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFFD97706)),
              onPressed: isUploading
                  ? null
                  : () async {
                      if (_urlInputController.text.trim().isEmpty) return;
                      final success = await provider.scrapeAndIngestUrl(
                        url: _urlInputController.text,
                        title: _urlTitleController.text,
                      );
                      if (mounted) {
                        if (success) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('URL content scraped, archived & indexed successfully!'),
                              backgroundColor: Color(0xFF10B981),
                            ),
                          );
                          _urlInputController.clear();
                          _urlTitleController.clear();
                        } else {
                          final errorText = provider.errorMessage ??
                              'Cannot extract text from this specific URL. The site may be protected or require login. Please copy and paste the text manually using the "Paste Raw Text" tab.';
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(errorText),
                              backgroundColor: const Color(0xFFEF4444),
                              duration: const Duration(seconds: 8),
                              action: SnackBarAction(
                                label: 'Paste Text',
                                textColor: Colors.white,
                                onPressed: () {
                                  setState(() {
                                    _selectedTabIndex = 1;
                                  });
                                },
                              ),
                            ),
                          );
                        }
                      }
                    },
              icon: const Icon(Icons.travel_explore),
              label: const Text('Fetch & Index'),
            ),
          ),
          if (isUploading) _buildProgressWidget(provider),
          if (!isUploading && provider.status == IngestionStatus.error && provider.errorMessage != null)
            _buildInlineErrorBanner(provider),
        ],
      ),
    );
  }

  Widget _buildInlineErrorBanner(IngestionProvider provider) {
    return Container(
      margin: const EdgeInsets.only(top: 16.0),
      padding: const EdgeInsets.all(14.0),
      decoration: BoxDecoration(
        color: const Color(0xFFEF4444).withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFEF4444).withOpacity(0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: Color(0xFFEF4444), size: 20),
              SizedBox(width: 8),
              Text(
                'Scraping Blocked or Failed',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFFEF4444)),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            provider.errorMessage ?? 'Cannot extract text from this URL.',
            style: const TextStyle(fontSize: 12, color: Colors.white70, height: 1.4),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              style: TextButton.styleFrom(
                foregroundColor: const Color(0xFF38BDF8),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              ),
              onPressed: () {
                setState(() {
                  _selectedTabIndex = 1; // switch to Raw Text tab
                });
              },
              icon: const Icon(Icons.paste_rounded, size: 16),
              label: const Text('Switch to "Paste Raw Text" Tab', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProgressWidget(IngestionProvider provider) {
    return Padding(
      padding: const EdgeInsets.only(top: 16.0),
      child: Column(
        children: [
          const LinearProgressIndicator(),
          const SizedBox(height: 8),
          Text(
            provider.statusMessage ?? 'Processing...',
            style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: Colors.grey),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildMetadataSelectorRow(BuildContext context, IngestionProvider provider, bool isUploading) {
    final availableCategories = provider.categories.isNotEmpty
        ? provider.categories.map((c) => c.name).toList()
        : [
            'Hadith',
            'Medicine',
            'English Language',
            'Arabic Language',
            'Arabic Dictionary',
            'English Dictionary',
          ];

    if (!availableCategories.contains(provider.selectedCategory)) {
      availableCategories.insert(0, provider.selectedCategory);
    }

    final languageOptions = ['Arabic', 'English', 'Mixed'];

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final isNarrow = constraints.maxWidth < 500;
          final categoryField = DropdownButtonFormField<String>(
            value: provider.selectedCategory,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Category',
              prefixIcon: const Icon(Icons.category_rounded, size: 20),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
            items: availableCategories.map((cat) {
              return DropdownMenuItem<String>(
                value: cat,
                child: Text(cat, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
              );
            }).toList(),
            onChanged: isUploading
                ? null
                : (val) {
                    if (val != null) provider.setSelectedCategory(val);
                  },
          );

          final languageField = DropdownButtonFormField<String>(
            value: provider.selectedLanguage,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Language',
              prefixIcon: const Icon(Icons.translate_rounded, size: 20),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
            items: languageOptions.map((lang) {
              return DropdownMenuItem<String>(
                value: lang,
                child: Text(lang, style: const TextStyle(fontSize: 13)),
              );
            }).toList(),
            onChanged: isUploading
                ? null
                : (val) {
                    if (val != null) provider.setSelectedLanguage(val);
                  },
          );

          if (isNarrow) {
            return Column(
              children: [
                categoryField,
                const SizedBox(height: 10),
                languageField,
              ],
            );
          }

          return Row(
            children: [
              Expanded(flex: 3, child: categoryField),
              const SizedBox(width: 12),
              Expanded(flex: 2, child: languageField),
            ],
          );
        },
      ),
    );
  }

  // Document History Section
  Widget _buildHistorySection(BuildContext context, IngestionProvider provider) {
    return GlassContainer(
      borderRadius: 16,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.between,
            children: [
              const Text('Indexed Documents in Vault', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
              IconButton(
                icon: const Icon(Icons.refresh, size: 18),
                onPressed: () => provider.fetchBooks(),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (provider.books.isEmpty)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(20.0),
                child: Text('No documents indexed yet.', style: TextStyle(color: Colors.grey)),
              ),
            )
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: provider.books.length,
              separatorBuilder: (_, __) => const Divider(height: 1, thickness: 0.5),
              itemBuilder: (context, idx) {
                final item = provider.books[idx];
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const CircleAvatar(
                    radius: 16,
                    backgroundColor: Color(0xFF10B981),
                    child: Icon(Icons.check, size: 16, color: Colors.white),
                  ),
                  title: Text(item.bookTitle, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 4.0),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFF38BDF8).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            item.category,
                            style: const TextStyle(fontSize: 10.5, color: Color(0xFF38BDF8), fontWeight: FontWeight.bold),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFA855F7).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            item.language,
                            style: const TextStyle(fontSize: 10.5, color: Color(0xFFA855F7), fontWeight: FontWeight.bold),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF472B6).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            '${item.totalPages} pages',
                            style: const TextStyle(fontSize: 10.5, color: Color(0xFFF472B6), fontWeight: FontWeight.bold),
                          ),
                        ),
                        Text('${item.totalChunks} chunks in Vault', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                      ],
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}
