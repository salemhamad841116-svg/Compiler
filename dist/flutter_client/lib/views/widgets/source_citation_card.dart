import 'package:flutter/material.dart';
import '../../models/source_citation.dart';
import 'glass_container.dart';

class SourceCitationCard extends StatefulWidget {
  final SourceCitation citation;
  final int index;

  const SourceCitationCard({
    super.key,
    required this.citation,
    required this.index,
  });

  @override
  State<SourceCitationCard> createState() => _SourceCitationCardState();
}

class _SourceCitationCardState extends State<SourceCitationCard> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final badgeColor = widget.citation.similarity >= 0.75
        ? const Color(0xFF10B981)
        : (widget.citation.similarity >= 0.50 ? Colors.amberAccent : Colors.blueAccent);

    return Container(
      margin: const EdgeInsets.only(top: 8.0),
      child: GlassContainer(
        borderRadius: 12.0,
        blurSigma: 8.0,
        backgroundColor: isDark
            ? Colors.black.withOpacity(0.25)
            : Colors.grey.shade100.withOpacity(0.6),
        borderColor: isDark
            ? Colors.white.withOpacity(0.1)
            : Colors.black.withOpacity(0.08),
        padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 8.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              borderRadius: BorderRadius.circular(8.0),
              onTap: () {
                setState(() {
                  _isExpanded = !_isExpanded;
                });
              },
              child: Row(
                children: [
                  Icon(
                    Icons.menu_book_rounded,
                    size: 16,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Source #${widget.index + 1}: ${widget.citation.bookTitle}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: badgeColor.withOpacity(0.18),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: badgeColor.withOpacity(0.4), width: 0.8),
                    ),
                    child: Text(
                      widget.citation.similarityPercentage,
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: isDark ? Colors.white : Colors.black87,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  AnimatedRotation(
                    turns: _isExpanded ? 0.5 : 0.0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(Icons.keyboard_arrow_down, size: 18),
                  ),
                ],
              ),
            ),
            AnimatedCrossFade(
              firstChild: const SizedBox.shrink(),
              secondChild: Padding(
                padding: const EdgeInsets.only(top: 8.0, bottom: 4.0),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10.0),
                  decoration: BoxDecoration(
                    color: isDark
                        ? Colors.white.withOpacity(0.03)
                        : Colors.white.withOpacity(0.8),
                    borderRadius: BorderRadius.circular(8.0),
                    border: Border.all(
                      color: isDark ? Colors.white.withOpacity(0.05) : Colors.black.withOpacity(0.05),
                    ),
                  ),
                  child: SelectableText(
                    widget.citation.excerpt,
                    style: theme.textTheme.bodySmall?.copyWith(
                      height: 1.4,
                      color: theme.textTheme.bodySmall?.color?.withOpacity(0.85),
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
              ),
              crossFadeState: _isExpanded ? CrossFadeState.showSecond : CrossFadeState.showFirst,
              duration: const Duration(milliseconds: 250),
            ),
          ],
        ),
      ),
    );
  }
}
