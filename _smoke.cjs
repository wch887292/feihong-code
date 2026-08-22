const fs=require('fs'); const vm=require('vm');
const html=fs.readFileSync('dist/web/public/index.html','utf8');
const m=html.match(/<script>([\s\S]*?)<\/script>/);
const code=m[1];
function makeEl(id){return {id,style:{},classList:{add(){},remove(){},contains(){return false}},addEventListener(){},removeEventListener(){},setAttribute(){},getAttribute(){return null},querySelector(){return null},querySelectorAll(){return []},appendChild(){},innerHTML:'',textContent:'',value:'',checked:false,click(){},focus(){},getContext(){return {}},dataset:{},parentElement:null};}
const store={};
const doc={getElementById(id){this._c=this._c||{};return this._c[id]||(this._c[id]=makeEl(id));},querySelector(){return makeEl('q');},querySelectorAll(){return [];},addEventListener(){},createElement(){return makeEl('c');},body:makeEl('body')};
const sandbox={window:{SpeechRecognition:null,webkitSpeechRecognition:null,location:{search:''},addEventListener(){},removeEventListener(){}},document:doc,localStorage:{getItem(k){return store[k]||null;},setItem(k,v){store[k]=v;},removeItem(k){delete store[k];}},fetch(){return Promise.resolve({ok:true,status:200,json(){return Promise.resolve({token:'x',phone:'138',models:[],defaultId:null,capabilities:[],automations:[],templates:[],entries:[],cwd:'/tmp'});}});},location:{search:''},console,setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},URLSearchParams,JSON,Date,Math,Promise,encodeURIComponent,decodeURIComponent,URL:function(){}};
sandbox.window.document=doc;sandbox.window.localStorage=sandbox.localStorage;sandbox.globalThis=sandbox;
try{vm.createContext(sandbox);vm.runInContext(code,sandbox,{filename:'inline.js'});console.log('SCRIPT INIT OK');}catch(e){console.log('SCRIPT INIT ERROR:',e.message);console.log(e.stack.split('\n').slice(0,6).join('\n'));}
