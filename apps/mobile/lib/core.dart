import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

// HTTPS is mandatory for deployed environments. This emulator address is local development only.
const apiBase = String.fromEnvironment('MERIDIAN_API', defaultValue: 'http://10.0.2.2:8080');
const secureStore = FlutterSecureStorage();
const primary = Color(0xFF3468E5);

/// A fresh `Idempotency-Key` value (32 hex characters, from a secure random source).
String newIdempotencyKey() {
  final rng = Random.secure();
  return List.generate(16, (_) => rng.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

class Api {
  /// Latest access token after a refresh rotation. Screens keep passing the token they were built
  /// with; once a rotation happened this newer one is used instead, so callers need no changes.
  static String? _access;
  static Future<bool>? _refreshing;

  /// Called when the server rejects the refresh token (session ended): go back to sign-in.
  static VoidCallback? onSignedOut;

  /// Store the tokens of a fresh sign-in (`/auth/login` response).
  static Future<void> adopt(Map<String, dynamic> login) async {
    _access = null;
    await secureStore.write(key: 'session_token', value: login['token'] as String);
    final refresh = login['refresh_token'];
    if (refresh is String) await secureStore.write(key: 'refresh_token', value: refresh);
  }

  static Future<void> clear() async {
    _access = null;
    await secureStore.delete(key: 'session_token');
    await secureStore.delete(key: 'refresh_token');
  }

  static Future<http.Response> _send(
    String path,
    String? bearer,
    String method,
    Object? data,
    Map<String, String>? extra,
  ) {
    final url = Uri.parse('$apiBase/api$path');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (bearer != null) 'Authorization': 'Bearer $bearer',
      ...?extra,
    };
    const limit = Duration(seconds: 15);
    switch (method) {
      case 'POST':
        return http.post(url, headers: headers, body: jsonEncode(data)).timeout(limit);
      case 'PATCH':
        return http.patch(url, headers: headers, body: jsonEncode(data)).timeout(limit);
      default:
        return http.get(url, headers: headers).timeout(limit);
    }
  }

  /// Rotate the session with the stored refresh token. Concurrent callers share one attempt
  /// (refresh tokens are single-use, so two parallel refreshes would trip reuse detection).
  static Future<bool> _refresh() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  static Future<bool> _doRefresh() async {
    final stored = await secureStore.read(key: 'refresh_token');
    if (stored == null) return false;
    try {
      final res = await http
          .post(Uri.parse('$apiBase/api/auth/refresh'),
              headers: {'Content-Type': 'application/json'}, body: jsonEncode({'refresh_token': stored}))
          .timeout(const Duration(seconds: 15));
      if (res.statusCode == 200) {
        final m = jsonDecode(res.body) as Map<String, dynamic>;
        _access = m['token'] as String;
        await secureStore.write(key: 'session_token', value: _access);
        await secureStore.write(key: 'refresh_token', value: m['refresh_token'] as String);
        return true;
      }
      if (res.statusCode == 401) {
        await clear();
        onSignedOut?.call();
      }
    } catch (_) {
      // Offline or timed out: keep the stored tokens and let the caller retry later.
    }
    return false;
  }

  /// One call with a single transparent refresh on 401. Returns the raw response.
  static Future<http.Response> _call(String path,
      {String? token, String method = 'GET', Object? data, Map<String, String>? headers}) async {
    var response = await _send(path, token == null ? null : (_access ?? token), method, data, headers);
    if (response.statusCode == 401 && token != null && !path.startsWith('/auth/') && await _refresh()) {
      response = await _send(path, _access, method, data, headers);
    }
    return response;
  }

  static dynamic _decode(http.Response response) {
    final parsed = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode >= 400) throw Exception(parsed is Map ? (parsed['error'] ?? 'Request failed') : 'Request failed');
    return parsed;
  }

  /// `headers` adds request headers such as `Idempotency-Key` or `If-Match`.
  static Future<dynamic> request(String path,
      {String? token, String method = 'GET', Object? data, Map<String, String>? headers}) async {
    return _decode(await _call(path, token: token, method: method, data: data, headers: headers));
  }

  /// Reads every page of a list endpoint, following `X-Next-Cursor` (at most 50 pages).
  static Future<List<dynamic>> requestAllPages(String path, {required String token, int pageSize = 200}) async {
    final all = <dynamic>[];
    String? cursor;
    for (var page = 0; page < 50; page++) {
      final separator = path.contains('?') ? '&' : '?';
      final cursorPart = cursor == null ? '' : '&cursor=${Uri.encodeQueryComponent(cursor)}';
      final response = await _call('$path$separator' 'limit=$pageSize$cursorPart', token: token);
      all.addAll(_decode(response) as List<dynamic>);
      cursor = response.headers['x-next-cursor'];
      if (cursor == null || cursor.isEmpty) break;
    }
    return all;
  }

  /// Like [request] for GET, and also returns the response ETag. An issue's ETag is the `If-Match`
  /// value an edit must send, so a stale save is refused instead of overwriting newer changes.
  static Future<({dynamic body, String? etag})> requestWithEtag(String path, {required String token}) async {
    final response = await _call(path, token: token);
    return (body: _decode(response), etag: response.headers['etag']);
  }
}

/// The message to show a person: the server's text when there is one, never the exception type.
String userMessage(Object e) => e.toString().replaceFirst('Exception: ', '');
