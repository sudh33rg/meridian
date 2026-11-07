import 'package:flutter/material.dart';
import 'core.dart';
import 'home.dart';

class EntryPage extends StatefulWidget { const EntryPage({super.key}); @override State<EntryPage> createState()=>_EntryPageState(); }
class _EntryPageState extends State<EntryPage> {
  String? token; bool loading=true;
  @override void initState(){super.initState();_restore();}
  Future<void> _restore() async {final t=await secureStore.read(key:'session_token');if(mounted)setState((){token=t;loading=false;});}
  @override Widget build(BuildContext context)=>loading
    ? const Scaffold(body:Center(child:CircularProgressIndicator()))
    : token==null ? LoginPage(onLogin:(t)=>setState(()=>token=t))
    : HomePage(token:token!,onLogout:()async{await secureStore.delete(key:'session_token');if(mounted)setState(()=>token=null);});
}
class LoginPage extends StatefulWidget { final ValueChanged<String> onLogin; const LoginPage({super.key,required this.onLogin});@override State<LoginPage> createState()=>_LoginPageState(); }
class _LoginPageState extends State<LoginPage> {
  final slug=TextEditingController(),email=TextEditingController(),password=TextEditingController();
  bool busy=false;String? error;
  @override void dispose(){slug.dispose();email.dispose();password.dispose();super.dispose();}
  Future<void> submit()async {
    setState((){busy=true;error=null;});
    try {
      final r=await Api.request('/auth/login',method:'POST',data:{'slug':slug.text,'email':email.text,'password':password.text});
      final t=r['token'] as String;await secureStore.write(key:'session_token',value:t);widget.onLogin(t);
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  @override Widget build(BuildContext context)=>Scaffold(body:SafeArea(child:Center(child:ConstrainedBox(
    constraints:const BoxConstraints(maxWidth:420),child:ListView(shrinkWrap:true,padding:const EdgeInsets.all(27),children:[
      const Icon(Icons.auto_awesome_mosaic_rounded,size:56,color:primary),const SizedBox(height:13),
      Text('meridian.',textAlign:TextAlign.center,style:Theme.of(context).textTheme.headlineLarge?.copyWith(fontWeight:FontWeight.w900)),
      const SizedBox(height:9),const Text('Work and knowledge, beautifully connected.',textAlign:TextAlign.center),
      const SizedBox(height:32),TextField(controller:slug,decoration:const InputDecoration(labelText:'Workspace slug',border:OutlineInputBorder())),
      const SizedBox(height:14),TextField(controller:email,keyboardType:TextInputType.emailAddress,decoration:const InputDecoration(labelText:'Work email',border:OutlineInputBorder())),
      const SizedBox(height:14),TextField(controller:password,obscureText:true,decoration:const InputDecoration(labelText:'Password',border:OutlineInputBorder())),
      if(error!=null)Padding(padding:const EdgeInsets.only(top:15),child:Text(error!,style:const TextStyle(color:Colors.red))),
      const SizedBox(height:24),FilledButton(onPressed:busy?null:submit,child:Padding(padding:const EdgeInsets.all(14),child:Text(busy?'Signing in…':'Sign in'))),
    ])))));
}

