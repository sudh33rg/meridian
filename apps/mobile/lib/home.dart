import 'dart:convert';
import 'package:flutter/material.dart';
import 'core.dart';
import 'reader.dart';
import 'issue.dart';

class HomePage extends StatefulWidget {
  final String token;final VoidCallback onLogout;
  const HomePage({super.key,required this.token,required this.onLogout});
  @override State<HomePage> createState()=>_HomePageState();
}
class _HomePageState extends State<HomePage>{
  List<dynamic> projects=[],issues=[],pages=[],sprints=[],goals=[],notifications=[],searchResults=[],drafts=[];
  String? projectId,error;bool loading=true;int section=0; final query=TextEditingController();
  @override void initState(){super.initState();load();_readDrafts();}
  @override void dispose(){query.dispose();super.dispose();}
  Future<void> _readDrafts() async {
    try {final raw=await secureStore.read(key:'issue_drafts');if(mounted)setState(()=>drafts=raw==null?[]:jsonDecode(raw) as List<dynamic>);}catch(_){/* corrupted local cache is not trusted */}
  }
  Future<void> _saveDrafts() async {await secureStore.write(key:'issue_drafts',value:jsonEncode(drafts.take(30).toList()));}
  void fail(Object e){if(mounted)setState(()=>error=userMessage(e));}
  Future<void> load() async {
    try {final p=await Api.request('/projects',token:widget.token) as List<dynamic>;
      if(!mounted)return;setState((){projects=p;if(!p.any((x)=>x['id']==projectId)){projectId=p.isEmpty?null:p.first['id'] as String;}});
      await loadDetails();
      final n=await Api.request('/notifications',token:widget.token) as List<dynamic>;
      if(mounted)setState(()=>notifications=n);
    }catch(e){fail(e);}finally{if(mounted)setState(()=>loading=false);}
  }
  Future<void> loadDetails() async {
    if(projectId==null){if(mounted)setState((){issues=[];pages=[];sprints=[];goals=[];});return;}
    try {final r=await Future.wait([
      Api.request('/projects/$projectId/issues',token:widget.token),Api.request('/projects/$projectId/pages',token:widget.token),
      Api.request('/projects/$projectId/sprints',token:widget.token),Api.request('/projects/$projectId/goals',token:widget.token),
    ]);if(mounted)setState((){issues=r[0];pages=r[1];sprints=r[2];goals=r[3];});}
    catch(e){fail(e);}
  }
  Future<void> addIssue() async {
    if(projectId==null)return;
    final title=TextEditingController();final description=TextEditingController();
    await showDialog<void>(context:context,builder:(ctx)=>AlertDialog(
      title:const Text('Create issue'),content:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,children:[
        TextField(controller:title,autofocus:true,maxLength:250,decoration:const InputDecoration(labelText:'Title')),
        TextField(controller:description,maxLines:3,decoration:const InputDecoration(labelText:'Description')),
      ])),actions:[TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Cancel')),
        FilledButton(onPressed:()async{
          final t=title.text.trim();if(t.isEmpty)return;
          final payload={'title':t,'description':description.text};
          // One key per submit: a retry of this same create reuses it and cannot duplicate the issue.
          final key=newIdempotencyKey();
          try{await Api.request('/projects/$projectId/issues',token:widget.token,method:'POST',data:payload,headers:{'Idempotency-Key':key});if(ctx.mounted)Navigator.pop(ctx);await loadDetails();}
          catch(e){
            if(ctx.mounted){Navigator.pop(ctx);}
            setState(()=>drafts.add({'project_id':projectId,...payload,'idempotency_key':key,'saved_at':DateTime.now().toIso8601String()}));await _saveDrafts();
            fail('Not sent. Saved a secure local draft; check whether the request succeeded before resubmitting. $e');
          }
        },child:const Text('Create'))]));
    title.dispose();description.dispose();
  }
  Future<void> search()async{if(query.text.trim().length<2)return;try{final r=await Api.request('/search?q=${Uri.encodeQueryComponent(query.text.trim())}',token:widget.token);if(mounted)setState(()=>searchResults=r);}catch(e){fail(e);}}
  Future<void> readNotification(dynamic n)async{try{await Api.request('/notifications/${n['id']}/read',token:widget.token,method:'POST');await load();}catch(e){fail(e);}}
  @override Widget build(BuildContext context){
    final current=projects.where((p)=>p['id']==projectId).toList();
    return Scaffold(
      appBar:AppBar(title:const Text('meridian.',style:TextStyle(fontWeight:FontWeight.w900)),actions:[
        IconButton(onPressed:load,tooltip:'Refresh',icon:const Icon(Icons.refresh)),
        IconButton(onPressed:widget.onLogout,tooltip:'Sign out',icon:const Icon(Icons.logout)),
      ]),
      body:loading?const Center(child:CircularProgressIndicator()):RefreshIndicator(onRefresh:load,child:ListView(
        physics:const AlwaysScrollableScrollPhysics(),padding:const EdgeInsets.all(18),children:[
          if(error!=null)Card(color:Colors.red.shade50,child:Padding(padding:const EdgeInsets.all(13),child:Row(children:[Expanded(child:Text(error!)),IconButton(onPressed:()=>setState(()=>error=null),icon:const Icon(Icons.close))]))),
          if(projects.isEmpty)const Padding(padding:EdgeInsets.all(30),child:Text('Create your first project using Meridian web to get started.')),
          if(projects.isNotEmpty)DropdownButtonFormField<String>(initialValue:projectId,
            decoration:const InputDecoration(labelText:'Project',border:OutlineInputBorder()),
            items:projects.map<DropdownMenuItem<String>>((p)=>DropdownMenuItem(value:p['id'] as String,child:Text(p['name'] as String))).toList(),
            onChanged:(v){setState(()=>projectId=v);loadDetails();}),
          const SizedBox(height:21),if(current.isNotEmpty)Text(current.first['name'],style:Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight:FontWeight.w800)),
          const SizedBox(height:5),Text('${issues.length} issues · ${pages.length} knowledge pages',style:TextStyle(color:Colors.blueGrey.shade400)),
          const SizedBox(height:20),
          if(section==0)...[
            if(drafts.isNotEmpty)Card(child:ExpansionTile(leading:const Icon(Icons.save_outlined),title:Text('${drafts.length} unsent drafts'),subtitle:const Text('Review before resubmitting'),children: drafts.asMap().entries.map((entry)=>ListTile(title:Text(entry.value['title']??''),subtitle:const Text('Stored locally; not synced'),trailing:IconButton(icon:const Icon(Icons.delete_outline),onPressed:()async{setState(()=>drafts.removeAt(entry.key));await _saveDrafts();}))).toList())),
            ...issues.map((i)=>Card(child:ListTile(leading:const Icon(Icons.task_alt,color:primary),title:Text(i['title']??''),subtitle:Text('${i['kind']} · ${i['status'].toString().replaceAll('_',' ')}'),trailing:const Icon(Icons.chevron_right),onTap:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>MobileIssuePage(token:widget.token,issueId:i['id'] as String))).then((_)=>loadDetails())))),
          ],
          if(section==1)...pages.map((p)=>Card(child:ListTile(leading:const Icon(Icons.description_outlined,color:primary),title:Text(p['title']??''),subtitle:Text('Version ${p['version']}'),onTap:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>MobilePageReader(page:p)))))),
          if(section==2)...[
            Text('Sprints',style:Theme.of(context).textTheme.titleMedium),const SizedBox(height:10),
            ...sprints.map((s)=>Card(child:ListTile(leading:const Icon(Icons.event_repeat,color:primary),title:Text(s['name']??''),subtitle:Text(s['goal']??''),trailing:Chip(label:Text(s['state']??''))))),
            const SizedBox(height:20),Text('Goals',style:Theme.of(context).textTheme.titleMedium),const SizedBox(height:10),
            ...goals.map((g)=>Card(child:ListTile(leading:const Icon(Icons.flag_outlined,color:primary),title:Text(g['title']??''),subtitle:LinearProgressIndicator(value:((g['progress'] as num?)??0)/100),trailing:Text('${g['progress']}%')))),
          ],
          if(section==3)...[
            ...notifications.map((n)=>Card(child:ListTile(leading:Icon(n['read_at']==null?Icons.notifications_active_outlined:Icons.notifications_none,color:primary),title:Text(n['title']??''),subtitle:Text(n['body']??''),trailing:n['read_at']==null?IconButton(onPressed:()=>readNotification(n),icon:const Icon(Icons.done)):null))),
            if(notifications.isEmpty)const ListTile(title:Text('All caught up'),subtitle:Text('There are no notifications right now.')),
          ],
          if(section==4)...[
            TextField(controller:query,onSubmitted:(_)=>search(),decoration:InputDecoration(prefixIcon:const Icon(Icons.search),hintText:'Search work and knowledge',suffixIcon:IconButton(onPressed:search,icon:const Icon(Icons.arrow_forward)),border:const OutlineInputBorder())),
            const SizedBox(height:15),...searchResults.map((r)=>Card(child:ListTile(leading:Icon(r['kind']=='page'?Icons.description_outlined:Icons.task_alt,color:primary),title:Text(r['title']??''),subtitle:Text(r['preview']??'',maxLines:2,overflow:TextOverflow.ellipsis)))),
          ],
        ],
      )),
      floatingActionButton:section==0&&projectId!=null?FloatingActionButton(onPressed:addIssue,tooltip:'New issue',child:const Icon(Icons.add)):null,
      bottomNavigationBar:NavigationBar(selectedIndex:section,onDestinationSelected:(v)=>setState(()=>section=v),destinations:const [
        NavigationDestination(icon:Icon(Icons.view_list_outlined),label:'Work'),
        NavigationDestination(icon:Icon(Icons.menu_book_outlined),label:'Docs'),
        NavigationDestination(icon:Icon(Icons.calendar_month_outlined),label:'Plan'),
        NavigationDestination(icon:Icon(Icons.notifications_outlined),label:'Inbox'),
        NavigationDestination(icon:Icon(Icons.search),label:'Search'),
      ]),
    );
  }
}

