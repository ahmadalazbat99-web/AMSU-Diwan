const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const dataDir = path.join(app.getPath('userData'), 'data');
const stateFile = path.join(dataDir, 'state.json');
const licenseFile = path.join(app.getPath('userData'), 'license.json');
const configFile = path.join(__dirname, 'license-config.json');
const attachmentsDir = path.join(dataDir, 'attachments');

fs.mkdirSync(attachmentsDir, { recursive: true });

let mainWindow = null;
let licenseCheckTimer = null;

function defaultState(){
  return {
    settings:{
      outgoingParties:[
        'كلية الطب',
        'كلية طب الأسنان',
        'كلية التمريض',
        'العلوم الطبية المخبرية',
        'تقنية الأشعة',
        'رئاسة الجامعة'
      ],
      incomingParties:[
        'وزارة التعليم العالي',
        'وزارة الصحة',
        'الجامعات',
        'المؤسسات الحكومية',
        'الجهات الخارجية'
      ],
      departments:[
        'ديوان الجامعة',
        'رئاسة الجامعة',
        'القبول والتسجيل',
        'المالية',
        'الموارد البشرية',
        'كلية الطب',
        'كلية طب الأسنان',
        'كلية التمريض',
        'العلوم الطبية المخبرية',
        'تقنية الأشعة'
      ],
      colleges:[
        'كلية الطب',
        'كلية طب الأسنان',
        'كلية التمريض',
        'العلوم الطبية المخبرية',
        'تقنية الأشعة',
        'رئاسة الجامعة'
      ],
      scanner:{
        source:'',
        dpi:'300',
        paper:'A4',
        color:'ألوان'
      }
    },

    users:[
      {
        id:1,
        username:'admin',
        name:'مدير النظام',
        password:'admin1234',
        role:'مدير',
        active:true,
        permissions:{
          dashboard:true,
          incoming:true,
          outgoing:true,
          archive:true,
          reports:true,
          users:true,
          settings:true,
          delete:true,
          archiveAction:true
        }
      }
    ],

    numbering:{
      incoming:0,
      outgoing:0,
      archive:0
    },

    docs:[],
    audit:[],
    logo:''
  };
}

function loadState(){
  try {
    if(fs.existsSync(stateFile)){
      const s = JSON.parse(fs.readFileSync(stateFile,'utf8'));

      if(
        s &&
        Array.isArray(s.users) &&
        s.users.length
      ){
        return s;
      }
    }
  } catch(e){
    console.error('Load state error:', e);
  }

  const s = defaultState();
  saveState(s);
  return s;
}

function saveState(s){
  fs.mkdirSync(dataDir,{recursive:true});
  fs.writeFileSync(
    stateFile,
    JSON.stringify(s,null,2),
    'utf8'
  );
}

function dataUrlToBuffer(dataUrl){
  const m = String(dataUrl || '').match(
    /^data:([^;]+);base64,(.+)$/s
  );

  if(!m){
    throw new Error('ملف مرفق غير صالح');
  }

  return {
    mime:m[1],
    buffer:Buffer.from(m[2],'base64')
  };
}

function safeName(name){
  return String(name || 'attachment')
    .replace(/[^\w\-.\u0600-\u06FF ]+/g,'_')
    .slice(0,120);
}

/* =========================
   LICENSE SYSTEM
========================= */

function loadConfig(){
  try {
    return JSON.parse(
      fs.readFileSync(configFile,'utf8')
    );
  } catch(e){
    console.error('Config load error:', e);
    return {};
  }
}

function saveLicense(license){
  fs.mkdirSync(
    path.dirname(licenseFile),
    {recursive:true}
  );

  fs.writeFileSync(
    licenseFile,
    JSON.stringify(license,null,2),
    'utf8'
  );
}

function loadLicense(){
  try {
    if(fs.existsSync(licenseFile)){
      return JSON.parse(
        fs.readFileSync(licenseFile,'utf8')
      );
    }
  } catch(e){
    console.error('License load error:',e);
  }

  return {
    deviceId:crypto.randomUUID(),
    deviceName:os.hostname(),
    licenseKey:'',
    status:'UNACTIVATED',
    version:app.getVersion(),
    lastServerCheck:null,
    lastError:null
  };
}

function ensureLicense(){
  const l = loadLicense();

  if(!l.deviceId){
    l.deviceId = crypto.randomUUID();
  }

  if(!l.deviceName){
    l.deviceName = os.hostname();
  }

  if(!l.status){
    l.status = l.licenseKey
      ? 'ACTIVE'
      : 'UNACTIVATED';
  }

  if(!l.version){
    l.version = app.getVersion();
  }

  saveLicense(l);

  return l;
}

function configReady(){
  const c = loadConfig();

  return !!(
    c.licenseCheckUrl &&
    !c.licenseCheckUrl.includes('PUT_SUPABASE') &&
    c.publishableKey &&
    !c.publishableKey.includes('PUT_SUPABASE')
  );
}

async function checkRemoteLicense(){

  const l = ensureLicense();
  const c = loadConfig();

  if(!configReady()){
    return {
      ok:false,
      offline:true,
      configured:false,
      license:l,
      message:'إعدادات الترخيص لم تُستكمل بعد'
    };
  }

  if(!l.licenseKey){
    return {
      ok:false,
      offline:true,
      configured:true,
      license:l,
      message:'البرنامج غير مُفعّل'
    };
  }

  try {

    const response = await fetch(
      c.licenseCheckUrl,
      {
        method:'POST',

        headers:{
          'Content-Type':'application/json',
          'apikey':c.publishableKey
        },

        body:JSON.stringify({
          device_id:l.deviceId,
          device_name:l.deviceName,
          version:app.getVersion(),
          license_key:l.licenseKey
        })
      }
    );

    const body = await response.json().catch(
      ()=>({})
    );

    if(!response.ok || !body.ok){

      l.lastServerCheck =
        new Date().toISOString();

      l.lastError =
        body.error ||
        `HTTP_${response.status}`;

      if(
        body.error === 'LICENSE_DISABLED' ||
        body.status === 'DISABLED'
      ){
        l.status = 'DISABLED';
      }

      saveLicense(l);

      return {
        ok:false,
        offline:false,
        configured:true,
        license:l,
        message:
          body.error ||
          'تعذر التحقق من الترخيص'
      };
    }

    const remote = body.device || {};

    l.deviceName =
      remote.device_name ||
      l.deviceName;

    l.status =
      remote.status ||
      'ACTIVE';

    l.version =
      remote.version ||
      app.getVersion();

    l.desiredVersion =
      body.desired_version ||
      remote.desired_version ||
      null;

    l.lastServerCheck =
      new Date().toISOString();

    l.lastError = null;

    saveLicense(l);

    return {
      ok:true,
      offline:false,
      configured:true,
      license:l
    };

  } catch(e){

    console.error(
      'Remote license check error:',
      e
    );

    l.lastError = 'NETWORK_ERROR';

    saveLicense(l);

    return {
      ok:l.status === 'ACTIVE',
      offline:true,
      configured:true,
      license:l,
      message:
        'لا يوجد اتصال بالإنترنت؛ تم استخدام آخر حالة محفوظة محليًا'
    };
  }
}

async function activateLicense(licenseKey){

  const l = ensureLicense();

  const key =
    String(licenseKey || '').trim();

  if(!key){
    return {
      ok:false,
      message:'أدخل مفتاح الترخيص'
    };
  }

  const c = loadConfig();

  if(!configReady()){
    return {
      ok:false,
      message:
        'يجب إعداد رابط Supabase ومفتاح Publishable أولًا'
    };
  }

  try {

    const response = await fetch(
      c.licenseCheckUrl,
      {
        method:'POST',

        headers:{
          'Content-Type':'application/json',
          'apikey':c.publishableKey
        },

        body:JSON.stringify({
          device_id:l.deviceId,
          device_name:l.deviceName,
          version:app.getVersion(),
          license_key:key
        })
      }
    );

    const body = await response.json().catch(
      ()=>({})
    );

    if(!response.ok || !body.ok){

      return {
        ok:false,
        message:
          body.error ||
          'مفتاح الترخيص غير صالح'
      };
    }

    const remote = body.device || {};

    l.licenseKey = key;

    l.status =
      remote.status ||
      'ACTIVE';

    l.deviceName =
      remote.device_name ||
      l.deviceName;

    l.version =
      remote.version ||
      app.getVersion();

    l.desiredVersion =
      body.desired_version ||
      remote.desired_version ||
      null;

    l.lastServerCheck =
      new Date().toISOString();

    l.lastError = null;

    saveLicense(l);

    return {
      ok:true,
      license:l
    };

  } catch(e){

    console.error(
      'Activate license error:',
      e
    );

    return {
      ok:false,
      message:
        'تعذر الاتصال بخادم الترخيص. تأكد من الإنترنت.'
    };
  }
}

function getLicenseStatus(){

  return {
    configured:configReady(),
    license:ensureLicense(),
    version:app.getVersion()
  };
}

function sendLicenseStatus(){

  if(
    mainWindow &&
    !mainWindow.isDestroyed()
  ){
    mainWindow.webContents.send(
      'license-status-changed',
      getLicenseStatus()
    );
  }
}

function lockWindowIfDisabled(){

  const l = ensureLicense();

  if(
    l.status === 'DISABLED' &&
    mainWindow &&
    !mainWindow.isDestroyed()
  ){
    mainWindow.webContents.send(
      'license-status-changed',
      getLicenseStatus()
    );
  }
}

/* =========================
   IPC
========================= */

ipcMain.handle(
  'init',
  ()=>{
    loadState();
    ensureLicense();
    return {ok:true};
  }
);

ipcMain.handle(
  'toggleFullscreen',
  ()=>{
    const w =
      BrowserWindow.getFocusedWindow();

    if(w){
      w.setFullScreen(
        !w.isFullScreen()
      );

      return w.isFullScreen();
    }

    return false;
  }
);

ipcMain.handle(
  'getState',
  ()=>{
    return loadState();
  }
);

ipcMain.handle(
  'saveState',
  (e,s)=>{
    saveState(s);
    return {ok:true};
  }
);

ipcMain.handle(
  'login',
  (e,{username,password})=>{

    const lic = ensureLicense();

    if(lic.status !== 'ACTIVE'){

      return {
        ok:false,
        message:
          lic.status === 'DISABLED'
            ? 'هذا الجهاز مُعطّل من إدارة الترخيص.'
            : 'البرنامج غير مُفعّل.'
      };
    }

    const s = loadState();

    const supplied =
      String(password || '');

    const u = s.users.find(
      x =>
        x.username ===
          String(username || '').trim() &&

        x.active !== false &&

        (
          (
            x.password &&
            x.password === supplied
          )

          ||

          (
            x.passwordHash &&

            crypto.timingSafeEqual(
              Buffer.from(
                x.passwordHash,
                'hex'
              ),

              crypto
                .createHash('sha256')
                .update(supplied)
                .digest()
            )
          )
        )
    );

    if(!u){

      return {
        ok:false,
        message:
          'اسم المستخدم أو كلمة المرور غير صحيح'
      };
    }

    u.lastLogin =
      new Date().toISOString();

    saveState(s);

    return {
      ok:true,
      user:u
    };
  }
);

ipcMain.handle(
  'saveAttachment',
  (e,a)=>{

    const {
      mime,
      buffer
    } = dataUrlToBuffer(
      a.dataUrl
    );

    const ext =
      mime === 'application/pdf'
        ? '.pdf'
        : (
            mime.split('/')[1] ||
            'bin'
          )
            .replace('jpeg','jpg');

    const fileName =
      Date.now() +
      '_' +
      Math.random()
        .toString(36)
        .slice(2,8) +
      ext;

    const full =
      path.join(
        attachmentsDir,
        safeName(fileName)
      );

    fs.writeFileSync(
      full,
      buffer
    );

    return {
      name:
        a.name ||
        fileName,

      path:full,
      mime,

      dataUrl:
        a.dataUrl
    };
  }
);

ipcMain.handle(
  'readAttachment',
  (e,p)=>{

    try {

      const b =
        fs.readFileSync(p);

      const ext =
        path.extname(p)
          .toLowerCase();

      const mime =
        ext === '.pdf'
          ? 'application/pdf'
          : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg';

      return (
        `data:${mime};base64,` +
        b.toString('base64')
      );

    } catch(e){

      return null;
    }
  }
);

ipcMain.handle(
  'saveLogo',
  (e,o)=>{

    const s = loadState();

    s.logo =
      o.dataUrl;

    saveState(s);

    return {ok:true};
  }
);

ipcMain.handle(
  'getLogo',
  ()=>{
    return loadState().logo || '';
  }
);

ipcMain.handle(
  'removeLogo',
  ()=>{

    const s =
      loadState();

    s.logo = '';

    saveState(s);

    return {ok:true};
  }
);

ipcMain.handle(
  'setUserPassword',
  (e,{id,pw})=>{

    const s =
      loadState();

    const u =
      s.users.find(
        x => x.id === id
      );

    if(u){

      u.password = pw;
      delete u.passwordHash;
    }

    saveState(s);

    return {ok:true};
  }
);

ipcMain.handle(
  'backup',
  async()=>{

    const s =
      loadState();

    const r =
      await dialog.showSaveDialog(
        {
          title:
            'حفظ النسخة الاحتياطية',

          defaultPath:
            `AMSU_Diwan_Backup_${new Date().toISOString().slice(0,10)}.json`,

          filters:[
            {
              name:'JSON',
              extensions:['json']
            }
          ]
        }
      );

    if(r.canceled){
      return {ok:false};
    }

    fs.writeFileSync(
      r.filePath,
      JSON.stringify(
        s,
        null,
        2
      ),
      'utf8'
    );

    return {ok:true};
  }
);

/* =========================
   LICENSE IPC
========================= */

ipcMain.handle(
  'getLicenseStatus',
  ()=>{
    return getLicenseStatus();
  }
);

ipcMain.handle(
  'activateLicense',
  async(e,key)=>{

    const r =
      await activateLicense(
        key
      );

    sendLicenseStatus();

    return r;
  }
);

ipcMain.handle(
  'checkLicense',
  async()=>{

    const r =
      await checkRemoteLicense();

    sendLicenseStatus();

    return r;
  }
);

/* =========================
   AUTO UPDATE
========================= */

async function setupAutoUpdater(){

  if(
    process.platform !== 'win32' ||
    !app.isPackaged
  ){
    return;
  }

  try {

    const {
      autoUpdater
    } = require('electron-updater');

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on(
      'checking-for-update',
      ()=>{
        mainWindow?.webContents.send(
          'update-status',
          {
            status:'checking'
          }
        );
      }
    );

    autoUpdater.on(
      'update-available',
      info=>{
        mainWindow?.webContents.send(
          'update-status',
          {
            status:'available',
            version:info.version
          }
        );
      }
    );

    autoUpdater.on(
      'update-not-available',
      ()=>{
        mainWindow?.webContents.send(
          'update-status',
          {
            status:'not-available'
          }
        );
      }
    );

    autoUpdater.on(
      'download-progress',
      p=>{
        mainWindow?.webContents.send(
          'update-status',
          {
            status:'downloading',
            percent:Math.round(p.percent)
          }
        );
      }
    );

    autoUpdater.on(
      'update-downloaded',
      info=>{
        mainWindow?.webContents.send(
          'update-status',
          {
            status:'downloaded',
            version:info.version
          }
        );
      }
    );

    autoUpdater.on(
      'error',
      e=>{
        console.error(
          'Auto-update error:',
          e
        );

        mainWindow?.webContents.send(
          'update-status',
          {
            status:'error',
            message:e.message
          }
        );
      }
    );

    await autoUpdater.checkForUpdates();

  } catch(e){

    console.error(
      'Auto-update setup error:',
      e
    );

  }
}

/* =========================
   WINDOW
========================= */

function createWindow(){

  mainWindow =
    new BrowserWindow({

      width:1440,
      height:900,

      minWidth:1100,
      minHeight:700,

      backgroundColor:'#f4f8fa',

      webPreferences:{
        preload:
          path.join(
            __dirname,
            'preload.js'
          ),

        contextIsolation:true,
        nodeIntegration:false
      }
    });

  mainWindow.removeMenu();

  mainWindow.loadFile(
    path.join(
      __dirname,
      'index.html'
    )
  );

  mainWindow.on(
    'closed',
    ()=>{
      mainWindow = null;
    }
  );
}

/* =========================
   APP START
========================= */

app.whenReady().then(
  async()=>{

    session.defaultSession
      .setPermissionRequestHandler(
        (
          webContents,
          permission,
          callback
        )=>{
          callback(
            ['media']
              .includes(permission)
          );
        }
      );

    ensureLicense();

    createWindow();

    await setupAutoUpdater();

    await checkRemoteLicense();

    sendLicenseStatus();

    const minutes =
      Math.max(
        5,
        Number(
          loadConfig()
            .heartbeatMinutes
        ) || 15
      );

    licenseCheckTimer =
      setInterval(
        async()=>{
          await checkRemoteLicense();
          lockWindowIfDisabled();
        },
        minutes * 60 * 1000
      );

    app.on(
      'activate',
      ()=>{
        if(
          BrowserWindow
            .getAllWindows()
            .length === 0
        ){
          createWindow();
        }
      }
    );
  }
);

app.on(
  'before-quit',
  ()=>{
    if(licenseCheckTimer){
      clearInterval(
        licenseCheckTimer
      );
    }
  }
);

app.on(
  'window-all-closed',
  ()=>{
    if(
      process.platform !== 'darwin'
    ){
      app.quit();
    }
  }
);
