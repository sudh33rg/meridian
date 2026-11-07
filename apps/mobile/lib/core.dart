import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

// HTTPS is mandatory for deployed environments. This emulator address is local development only.
const apiBase = String.fromEnvironment('MERIDIAN_API', defaultValue: 'http://10.0.2.2:8080');
const secureStore = FlutterSecureStorage();
const primary = Color(0xFF3468E5);

class Api {
  static Future<dynamic> request(String path, {String? token, String method = 'GET', Object? data}) async {
    final url = Uri.parse('$apiBase/api$path');
    final headers = <String,String>{'Content-Type':'application/json', if(token != null) 'Authorization':'Bearer $token'};
    final response = switch(method) {
      'POST' => await http.post(url,headers:headers,body:jsonEncode(data)).timeout(const Duration(seconds: 15)),
      'PATCH' => await http.patch(url,headers:headers,body:jsonEncode(data)).timeout(const Duration(seconds: 15)),
      _ => await http.get(url,headers:headers).timeout(const Duration(seconds: 15)),
    };
    final parsed = response.body.isEmpty ? null : jsonDecode(response.body);
    if(response.statusCode >= 400) throw Exception(parsed is Map ? (parsed['error'] ?? 'Request failed') : 'Request failed');
    return parsed;
  }
}

