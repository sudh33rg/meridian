import 'package:flutter/material.dart';

class MobilePageReader extends StatelessWidget {
  final dynamic page;const MobilePageReader({super.key,required this.page});
  @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text(page['title']??'Knowledge')),
    body:SingleChildScrollView(padding:const EdgeInsets.all(24),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      Text(page['title']??'',style:Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight:FontWeight.bold)),
      const SizedBox(height:8),Text('Version ${page['version']}',style:TextStyle(color:Colors.blueGrey.shade400)),
      const SizedBox(height:26),SelectableText(page['content']??'',style:const TextStyle(height:1.7,fontSize:15)),
    ])));
}

