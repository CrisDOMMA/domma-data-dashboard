const http=require('http'),fs=require('fs'),path=require('path');
const PORT=8099, DIR='/Users/cristina/Documents/DEVELOPER/DOMMA/domma-data-dashboard';
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
http.createServer((req,res)=>{
  let p=req.url.split('?')[0]; if(p==='/') p='/index.html';
  let fp=path.join(DIR,p);
  if(!fp.startsWith(DIR)){res.writeHead(403);return res.end()}
  try{ if(fs.statSync(fp).isDirectory()) fp=path.join(fp,'index.html'); }catch(e){}
  fs.readFile(fp,(err,data)=>{
    if(err){res.writeHead(404);return res.end('Not found: '+p)}
    res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});
    res.end(data);
  });
}).listen(PORT,()=>console.log('data-dashboard at http://localhost:'+PORT));
