import 'package:flutter/material.dart';
import 'core.dart';

/// A sprint's goal, totals and issues (sprint execution on the web, read-only here).
class SprintPage extends StatefulWidget {
  final String token;
  final String sprintId;
  final String name;
  const SprintPage({super.key, required this.token, required this.sprintId, required this.name});
  @override
  State<SprintPage> createState() => _SprintPageState();
}

class _SprintPageState extends State<SprintPage> {
  Map<String, dynamic>? data;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.request('/sprints/${widget.sprintId}', token: widget.token) as Map<String, dynamic>;
      if (mounted) setState(() => data = d);
    } catch (e) {
      if (mounted) setState(() => error = userMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final sprint = data?['sprint'] as Map<String, dynamic>?;
    final totals = data?['totals'] as Map<String, dynamic>?;
    final issues = (data?['issues'] as List<dynamic>?) ?? const [];
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: error != null
          ? Center(child: Text(error!))
          : data == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if ((sprint?['goal'] as String? ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(sprint!['goal'] as String),
                      ),
                    Text(
                      '${sprint?['state'] ?? ''} · ${totals?['done_count'] ?? 0} of ${totals?['scope_count'] ?? 0} done'
                      ' · ${totals?['done_points'] ?? 0} of ${totals?['scope_points'] ?? 0} points',
                    ),
                    const Divider(height: 24),
                    if (issues.isEmpty) const Text('No issues in this sprint.'),
                    ...issues.map(
                      (i) => ListTile(
                        title: Text((i as Map)['title'] ?? ''),
                        subtitle: Text('${i['kind']} · ${(i['status'] as String? ?? '').replaceAll('_', ' ')}'),
                      ),
                    ),
                  ],
                ),
    );
  }
}

/// A release's status, target and scope totals.
class ReleasePage extends StatefulWidget {
  final String token;
  final String releaseId;
  const ReleasePage({super.key, required this.token, required this.releaseId});
  @override
  State<ReleasePage> createState() => _ReleasePageState();
}

class _ReleasePageState extends State<ReleasePage> {
  Map<String, dynamic>? data;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.request('/releases/${widget.releaseId}', token: widget.token) as Map<String, dynamic>;
      if (mounted) setState(() => data = d);
    } catch (e) {
      if (mounted) setState(() => error = userMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final release = data?['release'] as Map<String, dynamic>?;
    final totals = data?['totals'] as Map<String, dynamic>?;
    return Scaffold(
      appBar: AppBar(title: Text(release?['name'] as String? ?? 'Release')),
      body: error != null
          ? Center(child: Text(error!))
          : data == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text('Status: ${release?['status'] ?? ''}'),
                    if (release?['target_at'] != null) Text('Target: ${release!['target_at']}'),
                    if ((release?['description'] as String? ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(release!['description'] as String),
                      ),
                    const Divider(height: 24),
                    Text(
                      '${totals?['done_count'] ?? 0} of ${totals?['scope_count'] ?? 0} issues done'
                      ' · ${totals?['done_points'] ?? 0} of ${totals?['scope_points'] ?? 0} points',
                    ),
                    if ((totals?['added_after_freeze'] ?? 0) > 0)
                      Text('${totals!['added_after_freeze']} added after the scope freeze'),
                  ],
                ),
    );
  }
}
