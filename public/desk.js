(function(){
  var D = {cfg:{whatsapp:''}, token:null, ok:true};
  // Translates simple "path" calls into the server's REST API (all security is enforced by the server).
  function api(m, u, b){
    var h = {'Content-Type':'application/json'}; if(D.token) h.Authorization = 'Bearer ' + D.token; if(D.ctoken) h['X-Customer-Token'] = D.ctoken;
    return fetch(u, {method:m, headers:h, body: b === undefined ? undefined : JSON.stringify(b)}).then(function(r){
      if(!r.ok) return r.json().catch(function(){return {}}).then(function(j){var e = new Error(j.error || ('api ' + r.status)); e.status = r.status; throw e});
      return r.json();
    });
  }
  function route(m, p, b){
    var s = p.split('/');
    if(m === 'GET'){
      if(p === 'settings') return api('GET', '/api/settings');
      if(p === 'orders') return api('GET', '/api/admin/orders');
      if(s[0] === 'orders' && s.length === 2) return api('GET', '/api/orders/' + s[1]);
      if(s[0] === 'images' && s[3] === 'd') return api('GET', '/api/images/' + s[1] + '/' + s[2]);
    }
    if(m === 'PUT'){
      if(p === 'settings') return api('PUT', '/api/settings', b);
      if(s[0] === 'orders' && s[2] === 'info') return api('POST', '/api/orders', Object.assign({id:s[1]}, b));
      if(s[0] === 'orders' && (s[2] === 'quote')) return api('PUT', '/api/orders/' + s[1] + '/quote', b);
      if(s[0] === 'orders' && (s[2] === 'decision' || s[2] === 'status')) return api('PUT', '/api/orders/' + s[1] + '/' + s[2], {v:b});
      if(s[0] === 'orders' && s.length === 2 && b === null) return api('DELETE', '/api/orders/' + s[1]);
      if(s[0] === 'images' && s.length === 3) return api('PUT', '/api/images/' + s[1] + '/' + s[2], b);
      if(s[0] === 'images' && s.length === 2 && b === null) return api('DELETE', '/api/images/' + s[1]);
    }
    if(m === 'POST' && s[0] === 'orders' && s[2] === 'chat') return api('POST', '/api/orders/' + s[1] + '/chat', b);
    return Promise.reject(new Error('unsupported ' + m + ' ' + p));
  }
  D.api = api;
  D.get = function(p){return route('GET', p)};
  D.put = function(p, b){return route('PUT', p, b)};
  D.post = function(p, b){return route('POST', p, b)};
  fetch('/api/config').then(function(r){return r.json()}).then(function(c){D.cfg = c}).catch(function(){});
  D.id = function(n){var a = new Uint8Array(n || 12); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function(x){return ('0' + x.toString(36)).slice(-2)}).join('')};
  D.esc = function(s){return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
  D.inr = function(n){return '₹' + Math.round(n || 0).toLocaleString('en-IN')};
  D.when = function(t){return new Date(t).toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})};
  D.date = function(v){if(!v) return 'Not decided'; var d = new Date(v + 'T00:00:00'); return isNaN(d) ? v : d.toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'})};
  // Mobile number -> digits with country code (same rule as the server). '' means not valid.
  D.phone = function(v){
    var raw = String(v || '').trim(), d = raw.replace(/\D/g, '');
    if(/^[6-9]\d{9}$/.test(d)) return '91' + d;
    if(/^0[6-9]\d{9}$/.test(d)) return '91' + d.slice(1);
    if(/^91[6-9]\d{9}$/.test(d)) return d;
    if(raw.charAt(0) === '+' && /^\d{8,15}$/.test(d)) return d;
    return '';
  };
  D.showPhone = function(d){d = String(d || ''); if(!d) return ''; return /^91\d{10}$/.test(d) ? '+91 ' + d.slice(2, 7) + ' ' + d.slice(7) : '+' + d};
  D.size = function(n){return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'};
  D.MAX_PDF = 8 * 1048576;
  D.isPdf = function(f){return !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name))};
  D.readDataUrl = function(file){
    return new Promise(function(ok, no){var r = new FileReader(); r.onload = function(){ok(r.result)}; r.onerror = function(){no(new Error('Could not read file'))}; r.readAsDataURL(file)});
  };
  // Rough page count of a PDF, read in the browser. Returns 0 when it cannot tell.
  D.pdfPages = function(file){
    return file.arrayBuffer().then(function(buf){
      var t = new TextDecoder('latin1').decode(new Uint8Array(buf)), n = (t.match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
      if(!n){(t.match(/\/Count\s+\d+/g) || []).forEach(function(c){n = Math.max(n, parseInt(c.replace(/\D/g, ''), 10))})}
      return n > 0 && n <= 200 ? n : 0;
    }).catch(function(){return 0});
  };
  // shrink a photo so it is small enough to store (max side px, JPEG)
  D.shrink = function(file, max){
    return new Promise(function(ok, no){
      var im = new Image(), u = URL.createObjectURL(file);
      im.onload = function(){
        var s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        var q = .78, d = c.toDataURL('image/jpeg', q);
        while(d.length > 300000 && q > .3){q -= .12; d = c.toDataURL('image/jpeg', q)}
        ok(d);
      };
      im.onerror = function(){no(new Error('Not an image'))};
      im.src = u;
    });
  };
  var cache = {};
  D.fillImages = function(root){
    root.querySelectorAll('img[data-k]').forEach(function(el){
      var key = el.dataset.oid + '/' + el.dataset.k;
      function set(d){if(/^data:image\//.test(d)) el.src = d}
      if(cache[key]) return set(cache[key]);
      D.get('images/' + key + '/d').then(function(d){if(d){cache[key] = d; set(d)}}).catch(function(){});
    });
  };
  window.DESK = D;
})();