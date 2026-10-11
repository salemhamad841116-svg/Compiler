import 'package:flutter/material.dart';
import '../models/chat_message.dart';
import '../services/api_service.dart';

class ChatProvider with ChangeNotifier {
  final ApiService _apiService;

  List<ChatMessage> _messages = [];
  bool _isProcessing = false;
  String? _errorMessage;
  bool _isBackendConnected = false;

  ChatProvider({required ApiService apiService}) : _apiService = apiService {
    _initWelcomeMessage();
    checkBackendConnection();
  }

  List<ChatMessage> get messages => List.unmodifiable(_messages);
  bool get isProcessing => _isProcessing;
  String? get errorMessage => _errorMessage;
  bool get isBackendConnected => _isBackendConnected;

  void _initWelcomeMessage() {
    _messages = [
      ChatMessage.assistant(
        id: 'msg_welcome',
        text: 'Hello! I am your **Private Book AI Assistant**.\n\nAsk me any question about the books in your knowledge base. My answers are strictly retrieved from your uploaded documents without outside assumptions.',
      ),
    ];
  }

  Future<void> checkBackendConnection() async {
    _isBackendConnected = await _apiService.checkHealth();
    notifyListeners();
  }

  Future<void> sendMessage(String text) async {
    final queryText = text.trim();
    if (queryText.isEmpty || _isProcessing) {
      return;
    }

    _errorMessage = null;
    final userMsgId = 'user_${DateTime.now().millisecondsSinceEpoch}';
    final assistantLoadingId = 'asst_${DateTime.now().millisecondsSinceEpoch}';

    _messages.add(ChatMessage.user(id: userMsgId, text: queryText));
    _messages.add(ChatMessage.loading(assistantLoadingId));
    _isProcessing = true;
    notifyListeners();

    try {
      final response = await _apiService.sendChatQuery(queryText);
      final answer = response['answer'] as String;
      final sources = response['sources'] as List<dynamic>;

      final index = _messages.indexWhere((m) => m.id == assistantLoadingId);
      if (index != -1) {
        _messages[index] = ChatMessage.assistant(
          id: assistantLoadingId,
          text: answer,
          sources: sources.cast(),
        );
      }
      _isBackendConnected = true;
    } catch (e) {
      _errorMessage = e.toString();
      final index = _messages.indexWhere((m) => m.id == assistantLoadingId);
      if (index != -1) {
        _messages[index] = ChatMessage.assistant(
          id: assistantLoadingId,
          text: '⚠️ An error occurred while retrieving information: ${e.toString().replaceAll("Exception: ", "")}',
          isError: true,
        );
      }
      _isBackendConnected = false;
    } finally {
      _isProcessing = false;
      notifyListeners();
    }
  }

  void clearChat() {
    _initWelcomeMessage();
    _errorMessage = null;
    notifyListeners();
  }
}
