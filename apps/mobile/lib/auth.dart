import 'package:flutter/material.dart';
import 'core.dart';
import 'home.dart';

class EntryPage extends StatefulWidget { const EntryPage({super.key}); @override State<EntryPage> createState()=>_EntryPageState(); }
class _EntryPageState extends State<EntryPage> {
  String? token; bool loading=true;
  @override void initState(){super.initState();Api.onSignedOut=(){if(mounted)setState(()=>token=null);};_restore();}
  @override void dispose(){Api.onSignedOut=null;super.dispose();}
  Future<void> _restore() async {final t=await secureStore.read(key:'session_token');if(mounted)setState((){token=t;loading=false;});}
  @override Widget build(BuildContext context)=>loading
    ? const Scaffold(body:Center(child:CircularProgressIndicator()))
    : token==null ? LoginPage(onLogin:(t)=>setState(()=>token=t))
    : HomePage(token:token!,onLogout:()async{try{await Api.request('/auth/logout',token:token,method:'POST');}catch(_){/* best effort: the local tokens are cleared regardless */}await Api.clear();if(mounted)setState(()=>token=null);});
}
class LoginPage extends StatefulWidget { final ValueChanged<String> onLogin; const LoginPage({super.key,required this.onLogin});@override State<LoginPage> createState()=>_LoginPageState(); }
class _LoginPageState extends State<LoginPage> {
  final slug=TextEditingController(),email=TextEditingController(),password=TextEditingController();
  final code=TextEditingController();
  bool busy=false;String? error;String? challenge;
  @override void dispose(){slug.dispose();email.dispose();password.dispose();code.dispose();super.dispose();}
  Future<void> submit()async {
    setState((){busy=true;error=null;});
    try {
      final r=await Api.request('/auth/login',method:'POST',data:{'slug':slug.text,'email':email.text,'password':password.text});
      if(r['mfa_required']==true){if(mounted)setState(()=>challenge=r['challenge'] as String);return;}
      await Api.adopt(r as Map<String,dynamic>);widget.onLogin(r['token'] as String);
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  /// Second step for accounts with two-step verification: authenticator code or recovery code.
  Future<void> verify()async {
    setState((){busy=true;error=null;});
    try {
      final r=await Api.request('/auth/mfa/verify',method:'POST',data:{'challenge':challenge,'code':code.text.trim()});
      await Api.adopt(r as Map<String,dynamic>);widget.onLogin(r['token'] as String);
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  @override Widget build(BuildContext context)=>Scaffold(body:SafeArea(child:Center(child:ConstrainedBox(
    constraints:const BoxConstraints(maxWidth:420),child:ListView(shrinkWrap:true,padding:const EdgeInsets.all(27),children:[
      const Icon(Icons.auto_awesome_mosaic_rounded,size:56,color:primary),const SizedBox(height:13),
      Text('meridian.',textAlign:TextAlign.center,style:Theme.of(context).textTheme.headlineLarge?.copyWith(fontWeight:FontWeight.w900)),
      const SizedBox(height:9),const Text('Work and knowledge, beautifully connected.',textAlign:TextAlign.center),
      if(challenge==null)...[
        const SizedBox(height:32),TextField(controller:slug,decoration:const InputDecoration(labelText:'Workspace slug',border:OutlineInputBorder())),
        const SizedBox(height:14),TextField(controller:email,keyboardType:TextInputType.emailAddress,decoration:const InputDecoration(labelText:'Work email',border:OutlineInputBorder())),
        const SizedBox(height:14),TextField(controller:password,obscureText:true,decoration:const InputDecoration(labelText:'Password',border:OutlineInputBorder())),
      ] else ...[
        const SizedBox(height:32),const Text('Two-step verification',textAlign:TextAlign.center,style:TextStyle(fontWeight:FontWeight.w700,fontSize:18)),
        const SizedBox(height:8),const Text('Enter the 6-digit code from your authenticator app, or a recovery code.',textAlign:TextAlign.center),
        const SizedBox(height:20),TextField(controller:code,autofocus:true,keyboardType:TextInputType.text,decoration:const InputDecoration(labelText:'Verification code',border:OutlineInputBorder())),
      ],
      if(error!=null)Padding(padding:const EdgeInsets.only(top:15),child:Text(error!,style:const TextStyle(color:Colors.red))),
      const SizedBox(height:24),FilledButton(onPressed:busy?null:(challenge==null?submit:verify),child:Padding(padding:const EdgeInsets.all(14),child:Text(busy?'Please wait…':(challenge==null?'Sign in':'Verify')))),
      if(challenge!=null)TextButton(onPressed:busy?null:()=>setState((){challenge=null;code.clear();error=null;}),child:const Text('Use a different account')),
    ])))));
}

