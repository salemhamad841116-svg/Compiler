import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import 'services/api_service.dart';
import 'providers/chat_provider.dart';
import 'providers/ingestion_provider.dart';
import 'views/screens/chat_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PrivateRagApp());
}

class PrivateRagApp extends StatelessWidget {
  const PrivateRagApp({super.key});

  @override
  Widget build(BuildContext context) {
    final apiService = ApiService();

    return MultiProvider(
      providers: [
        Provider<ApiService>.value(value: apiService),
        ChangeNotifierProvider(
          create: (context) => ChatProvider(apiService: apiService),
        ),
        ChangeNotifierProvider(
          create: (context) => IngestionProvider(apiService: apiService),
        ),
      ],
      child: MaterialApp(
        title: 'Private Book Assistant',
        debugShowCheckedModeBanner: false,
        themeMode: ThemeMode.system,
        theme: ThemeData(
          useMaterial3: true,
          brightness: Brightness.light,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF2563EB),
            brightness: Brightness.light,
            primary: const Color(0xFF2563EB),
            secondary: const Color(0xFF0D9488),
            surface: const Color(0xFFF8FAFC),
          ),
          textTheme: GoogleFonts.plusJakartaSansTextTheme(
            ThemeData.light().textTheme,
          ),
          scaffoldBackgroundColor: const Color(0xFFF1F5F9),
        ),
        darkTheme: ThemeData(
          useMaterial3: true,
          brightness: Brightness.dark,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF3B82F6),
            brightness: Brightness.dark,
            primary: const Color(0xFF3B82F6),
            secondary: const Color(0xFF14B8A6),
            surface: const Color(0xFF0F172A),
            background: const Color(0xFF020617),
          ),
          textTheme: GoogleFonts.plusJakartaSansTextTheme(
            ThemeData.dark().textTheme,
          ),
          scaffoldBackgroundColor: const Color(0xFF020617),
        ),
        home: const ChatScreen(),
      ),
    );
  }
}
