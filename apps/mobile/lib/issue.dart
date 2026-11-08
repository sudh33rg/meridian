import 'package:flutter/material.dart';
import 'core.dart';

class MobileIssuePage extends StatefulWidget {
  final String token,issueId;const MobileIssuePage({super.key,required this.token,required this.issueId});
  @override State<MobileIssuePage> createState()=>_MobileIssuePageState();
}
class _MobileIssuePageState extends State<MobileIssuePage> {
  dynamic issue;List<dynamic> comments=[];String? error;final comment=TextEditingController();String status='todo';
  /// ETag of the issue as last loaded; sent as If-Match so a stale status change is refused.
  String? _etag;
  /// The project's statuses in column order (key and name), loaded with the issue.
  List<dynamic> _statuses=[];
  @override void initState(){super.initState();load();}
  @override void dispose(){comment.dispose();super.dispose();}
  Future<void> load()async{try{final r=await Future.wait([
    Api.requestWithEtag('/issues/${widget.issueId}/details',token:widget.token),
    Api.request('/issues/${widget.issueId}/comments',token:widget.token),
  ]);final details=r[0] as ({dynamic body,String? etag});
  // The project's workflow decides which statuses this issue can take.
  final statuses=await Api.request('/projects/${details.body['project_id']}/statuses',token:widget.token) as List<dynamic>;
  if(mounted)setState((){issue=details.body;_etag=details.etag;comments=r[1] as List<dynamic>;_statuses=statuses;status=issue['status'] as String;error=null;});}
  catch(e){if(mounted)setState(()=>error=userMessage(e));}}
  Future<void> updateStatus(String next)async{
    try{await Api.request('/issues/${widget.issueId}/edit',token:widget.token,method:'PATCH',data:{'status':next},headers:_etag==null?null:{'If-Match':_etag!});await load();}
    on ConflictError {
      // Someone changed the issue after this device loaded it. Show what is there now and let the person decide.
      await load();
      if(mounted)await _conflictDialog(next);
    }
    catch(e){
      final message=userMessage(e);await load();if(mounted)setState(()=>error=message);
    }}
  /// Shows the latest status after a conflict. The person either keeps it or applies their change on top.
  Future<void> _conflictDialog(String next)async{
    final latest=_statuses.where((s)=>s['key']==status).map((s)=>s['name'] as String).firstOrNull??status;
    final wanted=_statuses.where((s)=>s['key']==next).map((s)=>s['name'] as String).firstOrNull??next;
    final apply=await showDialog<bool>(context:context,builder:(c)=>AlertDialog(
      title:const Text('This issue changed'),
      content:Text('It is now "$latest" on the server. Your change was to "$wanted". Apply your change to the latest version?'),
      actions:[
        TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('Keep the latest')),
        FilledButton(onPressed:()=>Navigator.pop(c,true),child:const Text('Apply my change')),
      ],
    ));
    if(apply==true)await updateStatus(next);
  }
  Future<void> postComment()async{if(comment.text.trim().isEmpty)return;try{await Api.request('/issues/${widget.issueId}/comments',token:widget.token,method:'POST',data:{'body':comment.text.trim()});comment.clear();await load();}catch(e){if(mounted)setState(()=>error=userMessage(e));}}
  @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text('Issue ${issue?['number']??''}')),
    body:issue==null?Center(child:Text(error??'Loading…')):ListView(padding:const EdgeInsets.all(19),children:[
      if(error!=null)Text(error!,style:const TextStyle(color:Colors.red)),
      Text(issue['title']??'',style:Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight:FontWeight.w800)),
      const SizedBox(height:9),Text(issue['description']??'No description',style:TextStyle(color:Colors.blueGrey.shade500,height:1.5)),
      const SizedBox(height:22),DropdownButtonFormField<String>(key:ValueKey('status-$status'),initialValue:status,decoration:const InputDecoration(labelText:'Status',border:OutlineInputBorder()),items:[
        for(final s in _statuses)DropdownMenuItem<String>(value:s['key'] as String,child:Text(s['name'] as String)),
      ],onChanged:(v){if(v!=null)updateStatus(v);}),
      const SizedBox(height:26),Text('Discussion (${comments.length})',style:Theme.of(context).textTheme.titleMedium),
      const SizedBox(height:12),...comments.map((c)=>Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text(c['author']??'',style:const TextStyle(fontWeight:FontWeight.bold)),const SizedBox(height:7),Text(c['body']??''),
      ])))),
      const SizedBox(height:16),TextField(controller:comment,maxLines:3,decoration:const InputDecoration(labelText:'Comment',border:OutlineInputBorder())),
      const SizedBox(height:13),FilledButton.icon(onPressed:postComment,icon:const Icon(Icons.send),label:const Text('Post comment')),
    ]));
}

