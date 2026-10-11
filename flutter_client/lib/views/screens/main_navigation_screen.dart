import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/localization_provider.dart';
import 'chat_screen.dart';
import 'supervisor_dashboard_screen.dart';
import 'books_screen.dart';

/// Main root navigation shell with native bottom navigation bar,
/// SafeArea compatibility (notches, dynamic islands, rounded corners),
/// and state-preserving IndexedStack.
class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _currentIndex = 0;

  final List<Widget> _screens = const [
    ChatScreen(),
    SupervisorDashboardScreen(),
    BooksScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final loc = context.watch<LocalizationProvider>();

    return Directionality(
      textDirection: loc.textDirection,
      child: Scaffold(
        body: IndexedStack(
          index: _currentIndex,
          children: _screens,
        ),
        bottomNavigationBar: SafeArea(
          top: false,
          bottom: true,
          child: NavigationBar(
            selectedIndex: _currentIndex,
            onDestinationSelected: (index) {
              setState(() {
                _currentIndex = index;
              });
            },
            indicatorColor: theme.colorScheme.primary.withOpacity(0.18),
            destinations: [
              NavigationDestination(
                icon: const Icon(Icons.forum_outlined),
                selectedIcon: Icon(Icons.forum, color: theme.colorScheme.primary),
                label: loc.tr('nav_chat', 'AI Chat'),
              ),
              NavigationDestination(
                icon: const Icon(Icons.drive_file_move_outlined),
                selectedIcon: Icon(Icons.drive_file_move, color: theme.colorScheme.primary),
                label: loc.tr('nav_supervisor', 'Supervisor Hub'),
              ),
              NavigationDestination(
                icon: const Icon(Icons.auto_stories_outlined),
                selectedIcon: Icon(Icons.auto_stories, color: theme.colorScheme.primary),
                label: loc.tr('nav_library', 'Knowledge Base'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
