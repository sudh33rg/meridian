import 'package:flutter/material.dart';
import 'core.dart';

class MobileIssuePage extends StatefulWidget {
  final String token,issueId;const MobileIssuePage({super.key,required this.token,required this.issueId});
  @override State<MobileIssuePage> createState()=>_MobileIssuePageState();
}
class _MobileIssuePageState extends State<MobileIssuePage> {
  dynamic issue;List<dynamic> comments=[];String? error;final comment=TextEditingController();String status='todo';
  @override void initState(){super.initState();load();}
  @override void dispose(){comment.dispose();super.dispose();}
  Future<void> load()async{try{final r=await Future.wait([
    Api.request('/issues/${widget.issueId}/details',token:widget.token),
    Api.request('/issues/${widget.issueId}/comments',token:widget.token),
  ]);if(mounted)setState((){issue=r[0];comments=r[1];status=issue['status'] as String;error=null;});}
  catch(e){if(mounted)setState(()=>error=e.toString());}}
  Future<void> updateStatus(String next)async{try{await Api.request('/issues/${widget.issueId}/edit',token:widget.token,method:'PATCH',data:{'status':next});await load();}catch(e){if(mounted)setState(()=>error=e.toString());}}
  Future<void> postComment()async{if(comment.text.trim().isEmpty)return;try{await Api.request('/issues/${widget.issueId}/comments',token:widget.token,method:'POST',data:{'body':comment.text.trim()});comment.clear();await load();}catch(e){if(mounted)setState(()=>error=e.toString());}}
  @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text('Issue ${issue?['number']??''}')),
    body:issue==null?Center(child:Text(error??'Loading…')):ListView(padding:const EdgeInsets.all(19),children:[
      if(error!=null)Text(error!,style:const TextStyle(color:Colors.red)),
      Text(issue['title']??'',style:Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight:FontWeight.w800)),
      const SizedBox(height:9),Text(issue['description']??'No description',style:TextStyle(color:Colors.blueGrey.shade500,height:1.5)),
      const SizedBox(height:22),DropdownButtonFormField<String>(value:status,decoration:const InputDecoration(labelText:'Status',border:OutlineInputBorder()),items:const [
        DropdownMenuItem(value:'todo',child:Text('To do')),
        DropdownMenuItem(value:'in_progress',child:Text('In progress')),
        DropdownMenuItem(value:'in_review',child:Text('In review')),
        DropdownMenuItem(value:'done',child:Text('Done')),
      ],onChanged:(v){if(v!=null)updateStatus(v);}),
      const SizedBox(height:26),Text('Discussion (${comments.length})',style:Theme.of(context).textTheme.titleMedium),
      const SizedBox(height:12),...comments.map((c)=>Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text(c['author']??'',style:const TextStyle(fontWeight:FontWeight.bold)),const SizedBox(height:7),Text(c['body']??''),
      ])))),
      const SizedBox(height:16),TextField(controller:comment,maxLines:3,decoration:const InputDecoration(labelText:'Comment',border:OutlineInputBorder())),
      const SizedBox(height:13),FilledButton.icon(onPressed:postComment,icon:const Icon(Icons.send),label:const Text('Post comment')),
    ]));
}

