import 'source_citation.dart';

enum MessageSender {
  user,
  assistant,
}

class ChatMessage {
  final String id;
  final String text;
  final MessageSender sender;
  final DateTime timestamp;
  final List<SourceCitation> sources;
  final bool isLoading;
  final bool isError;

  ChatMessage({
    required this.id,
    required this.text,
    required this.sender,
    required this.timestamp,
    this.sources = const [],
    this.isLoading = false,
    this.isError = false,
  });

  factory ChatMessage.loading(String id) {
    return ChatMessage(
      id: id,
      text: '',
      sender: MessageSender.assistant,
      timestamp: DateTime.now(),
      isLoading: true,
    );
  }

  factory ChatMessage.user({required String id, required String text}) {
    return ChatMessage(
      id: id,
      text: text,
      sender: MessageSender.user,
      timestamp: DateTime.now(),
    );
  }

  factory ChatMessage.assistant({
    required String id,
    required String text,
    List<SourceCitation> sources = const [],
    bool isError = false,
  }) {
    return ChatMessage(
      id: id,
      text: text,
      sender: MessageSender.assistant,
      timestamp: DateTime.now(),
      sources: sources,
      isError: isError,
    );
  }

  ChatMessage copyWith({
    String? id,
    String? text,
    MessageSender? sender,
    DateTime? timestamp,
    List<SourceCitation>? sources,
    bool? isLoading,
    bool? isError,
  }) {
    return ChatMessage(
      id: id ?? this.id,
      text: text ?? this.text,
      sender: sender ?? this.sender,
      timestamp: timestamp ?? this.timestamp,
      sources: sources ?? this.sources,
      isLoading: isLoading ?? this.isLoading,
      isError: isError ?? this.isError,
    );
  }
}
