// Cours Albert 3 — application macOS (Cocoa + WebKit), moteur Node.js embarqué et serveur local des espaces collaboratifs.
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <UserNotifications/UserNotifications.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <signal.h>

static NSString *const kVersion = @"3.3.2";
static NSString *const kSyncAgent = @"com.coursalbert.sync";
static NSString *const kLoginAgent = @"com.coursalbert.menubar";
static NSString *const kReminderPrefix = @"ca-rem-";

#pragma mark - Zone de déplacement de la fenêtre

@interface DragStrip : NSView
@end
@implementation DragStrip
- (BOOL)mouseDownCanMoveWindow { return YES; }
- (void)mouseDown:(NSEvent *)event {
    if (event.clickCount == 2) { [self.window performZoom:nil]; return; }
    [self.window performWindowDragWithEvent:event];
}
@end

#pragma mark - Contrôleur

@interface AppController : NSObject <NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *webView;
@property (strong) NSStatusItem *statusItem;
@property (strong) NSTask *engine;
@property (strong) NSTimer *progressTimer;
@property (strong) NSTimer *clockTimer;
@property (copy) NSString *supportDir;
@property (copy) NSString *configPath;
@property (copy) NSString *favoritePath;
@property (copy) NSString *lastProgress;
@property (strong) NSDictionary *dataCache;
@property (strong) NSDate *dataCacheDate;
@property (assign) BOOL vibrancy;
@property (assign) BOOL uiReady;
@property (assign) BOOL menubarLaunch;
@property (copy) NSString *pendingRoute;
// Serveur local des espaces (node espaces/server.mjs), relancé s’il s’arrête.
@property (strong) NSTask *server;
@property (strong) NSFileHandle *serverInput;
@property (strong) NSMutableData *serverOut;
@property (copy) NSString *serverToken;
@property (strong) NSNumber *serverPort;
@property (strong) NSNumber *serverLanPort;
@property (copy) NSString *serverError;
@property (strong) NSArray *serverRoots;
@property (strong) NSMutableArray *serverRestarts;
@property (assign) BOOL serverReady;
@property (assign) BOOL quitting;
@property (assign) BOOL uiLoaded;
@property (strong) NSURL *loadedURL;
@property (strong) NSMutableArray *pendingOpen;
@property (strong) NSMutableSet *sessionPaths;
@property (strong) NSNumber *printReply;
@property (copy) NSString *printDest;
@end

@implementation AppController

#pragma mark Outils

- (NSString *)resource:(NSString *)name { return [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:name]; }
- (NSString *)nodePath {
#if __x86_64__
    return [self resource:@"node-x64"];
#else
    return [self resource:@"node-arm64"];
#endif
}
- (NSString *)home { return NSHomeDirectory(); }
- (NSString *)defaultLibrary { return [self.home stringByAppendingPathComponent:@"Documents/Cours Albert"]; }
- (NSString *)defaultDesktop { return [self.home stringByAppendingPathComponent:@"Desktop/Cours Albert"]; }
- (id)readJSONFile:(NSString *)file {
    NSData *data = [NSData dataWithContentsOfFile:file];
    return data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
}
- (NSDictionary *)readJSON:(NSString *)file { id o = [self readJSONFile:file]; return [o isKindOfClass:NSDictionary.class] ? o : nil; }
- (BOOL)writeJSON:(NSDictionary *)dictionary to:(NSString *)file {
    NSData *data = [NSJSONSerialization dataWithJSONObject:dictionary options:NSJSONWritingPrettyPrinted error:nil];
    return data && [data writeToFile:file atomically:YES];
}
- (NSString *)supportFile:(NSString *)name { return [self.supportDir stringByAppendingPathComponent:name]; }
- (void)setupSupport {
    NSString *override = NSProcessInfo.processInfo.environment[@"COURS_ALBERT_SUPPORT_DIR"];
    self.supportDir = override ?: [self.home stringByAppendingPathComponent:@"Library/Application Support/Cours Albert Sync"];
    [NSFileManager.defaultManager createDirectoryAtPath:self.supportDir withIntermediateDirectories:YES attributes:nil error:nil];
    self.configPath = [self supportFile:@"config.json"];
    self.favoritePath = [self supportFile:@"derniers-dossiers.json"];
}
- (BOOL)hasConfig { return [self readJSON:self.configPath] != nil; }
- (NSDictionary *)defaultNotifications { return @{@"classReminder": @10, @"examReminder": @YES, @"materials": @YES, @"exams": @YES, @"absences": @YES, @"changes": @YES, @"grades": @YES}; }
- (NSMutableDictionary *)settings {
    NSMutableDictionary *s = [NSMutableDictionary dictionaryWithDictionary:[self readJSON:self.configPath] ?: [self readJSON:self.favoritePath] ?: @{}];
    if (!s[@"vaultCourses"]) s[@"vaultCourses"] = [self defaultLibrary];
    if (!s[@"desktopCourses"]) s[@"desktopCourses"] = [self defaultDesktop];
    if (!s[@"driveFolders"]) s[@"driveFolders"] = @[];
    if (!s[@"academicYearStart"]) s[@"academicYearStart"] = @([[NSCalendar.currentCalendar components:NSCalendarUnitYear fromDate:NSDate.date] year]);
    if (!s[@"automatic"]) s[@"automatic"] = @YES;
    if (!s[@"menubar"]) s[@"menubar"] = @YES;
    if (!s[@"launchAtLogin"]) s[@"launchAtLogin"] = @NO;
    if (!s[@"vaultEnabled"]) s[@"vaultEnabled"] = @([self vaultRootFor:s[@"vaultCourses"]] != nil);
    NSMutableDictionary *n = [NSMutableDictionary dictionaryWithDictionary:[self defaultNotifications]];
    if ([s[@"notifications"] isKindOfClass:NSDictionary.class]) [n addEntriesFromDictionary:s[@"notifications"]];
    s[@"notifications"] = n;
    return s;
}
- (NSString *)vaultRootFor:(NSString *)folder {
    if (!folder.length) return nil;
    for (NSString *dir = folder.stringByStandardizingPath; dir.length > 1; dir = dir.stringByDeletingLastPathComponent) {
        if ([NSFileManager.defaultManager fileExistsAtPath:[dir stringByAppendingPathComponent:@".obsidian"]]) return dir;
    }
    return nil;
}
- (NSDictionary *)data {
    NSString *file = [self supportFile:@"data.json"];
    NSDate *modified = [[NSFileManager.defaultManager attributesOfItemAtPath:file error:nil] fileModificationDate];
    if (!modified) return nil;
    if (!self.dataCache || ![modified isEqualToDate:self.dataCacheDate]) { self.dataCache = [self readJSON:file]; self.dataCacheDate = modified; }
    return self.dataCache;
}
- (NSString *)installedAppPath {
    NSString *system = @"/Applications/Cours Albert.app";
    if ([NSFileManager.defaultManager fileExistsAtPath:system]) return system;
    NSString *personal = [self.home stringByAppendingPathComponent:@"Applications/Cours Albert.app"];
    return [NSFileManager.defaultManager fileExistsAtPath:personal] ? personal : nil;
}
- (BOOL)engineRunningElsewhere {
    NSString *pid = [NSString stringWithContentsOfFile:[self supportFile:@".running"] encoding:NSUTF8StringEncoding error:nil];
    return pid.intValue > 0 && kill(pid.intValue, 0) == 0;
}
- (NSString *)tail:(NSString *)file bytes:(NSUInteger)count {
    NSFileHandle *h = [NSFileHandle fileHandleForReadingAtPath:file]; if (!h) return @"";
    unsigned long long size = [h seekToEndOfFile];
    [h seekToFileOffset:size > count ? size - count : 0];
    NSData *d = [h readDataToEndOfFile]; [h closeFile];
    return [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] ?: @"";
}
- (NSString *)logText {
    NSString *manual = [self tail:[self supportFile:@"manual.log"] bytes:6000];
    NSString *automatic = [self tail:[self supportFile:@"automatic.log"] bytes:3000];
    NSMutableString *s = [NSMutableString string];
    if (manual.length) [s appendFormat:@"— Synchronisations lancées depuis l’app —\n%@\n", manual];
    if (automatic.length) [s appendFormat:@"— Synchronisations automatiques —\n%@", automatic];
    return s;
}
- (NSString *)notificationStatus:(UNAuthorizationStatus)status {
    switch (status) { case UNAuthorizationStatusAuthorized: case UNAuthorizationStatusProvisional: return @"authorized"; case UNAuthorizationStatusDenied: return @"denied"; default: return @"notDetermined"; }
}
- (NSDictionary *)envWithNotifications:(NSString *)notifications {
    BOOL chrome = [NSFileManager.defaultManager fileExistsAtPath:@"/Applications/Google Chrome.app"] || [NSFileManager.defaultManager fileExistsAtPath:[self.home stringByAppendingPathComponent:@"Applications/Google Chrome.app"]];
    return @{@"version": kVersion, @"hasConfig": @([self hasConfig]), @"installed": @([self installedAppPath] != nil), @"vibrancy": @(self.vibrancy), @"chrome": @(chrome), @"notifications": notifications ?: @"notDetermined", @"supportDir": self.supportDir, @"spaces": [self spacesInfo]};
}

#pragma mark Démarrage

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    [self setupSupport];
    [self buildMainMenu];
    UNUserNotificationCenter.currentNotificationCenter.delegate = self;
    // Le serveur des espaces démarre avec l’app ; au lancement discret (barre des menus), seulement si le partage local est actif.
    if (!self.menubarLaunch || [self spacesLanWanted]) [self startSpacesServer];
    NSDictionary *s = [self settings];
    if ([s[@"menubar"] boolValue] && [self hasConfig]) [self setupStatusItem];
    if (self.menubarLaunch) {
        NSArray *others = [NSRunningApplication runningApplicationsWithBundleIdentifier:NSBundle.mainBundle.bundleIdentifier ?: @""];
        if (others.count > 1 || !self.statusItem) { [NSApp terminate:nil]; return; }
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    } else {
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        [self showWindow];
    }
    self.clockTimer = [NSTimer scheduledTimerWithTimeInterval:30 target:self selector:@selector(tick) userInfo:nil repeats:YES];
    if ([self engineRunningElsewhere]) [self startProgressPolling];
    if ([self hasConfig] && ![self data] && ![self engineRunningElsewhere]) [self runDataOnlyThen:^{ [self pushData]; if (!self.menubarLaunch) [self startSync:@"normal"]; }];
}
- (void)tick {
    [self refreshStatusItem];
    if (!self.engine.isRunning && !self.progressTimer && [self engineRunningElsewhere]) [self startProgressPolling];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return self.statusItem == nil; }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    self.quitting = YES;
    if (!self.server.isRunning) return NSTerminateNow;
    // Fermer l’entrée du serveur lui demande d’enregistrer les espaces puis de s’arrêter.
    @try { [self.serverInput closeFile]; } @catch (NSException *e) {}
    // Pendant NSTerminateLater, la boucle tourne en mode « panneau modal » : le minuteur doit être inscrit dans les modes communs.
    __block int ticks = 0;
    NSTimer *wait = [NSTimer timerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *t) {
        if (self.server.isRunning && ++ticks < 40) return;
        [t invalidate];
        if (self.server.isRunning) [self.server terminate];
        [NSApp replyToApplicationShouldTerminate:YES];
    }];
    [NSRunLoop.mainRunLoop addTimer:wait forMode:NSRunLoopCommonModes];
    return NSTerminateLater;
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
    for (NSURL *u in urls) {
        if (!u.isFileURL) continue;
        NSString *path = u.path.stringByStandardizingPath, *ext = u.pathExtension.lowercaseString;
        [self.sessionPaths ?: (self.sessionPaths = [NSMutableSet set]) addObject:path];
        BOOL space = [ext isEqualToString:@"coursalbert"] || [ext isEqualToString:@"cae"];
        [self deliver:@{@"type": space ? @"importSpace" : @"openText", @"path": path}];
    }
    [self showWindow];
}
- (void)deliver:(NSDictionary *)message {
    if (self.uiReady && self.webView) { [self send:message]; return; }
    if (!self.pendingOpen) self.pendingOpen = [NSMutableArray array];
    [self.pendingOpen addObject:message];
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag { [self showWindow]; return YES; }
- (void)windowWillClose:(NSNotification *)notification {
    if (notification.object != self.window) return;
    self.uiReady = NO; self.uiLoaded = NO;
    [self.webView.configuration.userContentController removeScriptMessageHandlerForName:@"coursAlbert"];
    self.webView = nil; self.window = nil;
    if (self.statusItem) [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
}
- (void)showWindow {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    if (!self.window) [self makeWindow];
    [NSApp activateIgnoringOtherApps:YES];
    [self.window makeKeyAndOrderFront:nil];
}
- (void)makeWindow {
    NSRect frame = NSMakeRect(0, 0, 1180, 780);
    NSWindow *w = [[NSWindow alloc] initWithContentRect:frame styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView) backing:NSBackingStoreBuffered defer:NO];
    w.title = @"Cours Albert"; w.titlebarAppearsTransparent = YES; w.titleVisibility = NSWindowTitleHidden;
    w.minSize = NSMakeSize(960, 620); w.releasedWhenClosed = NO; w.delegate = self; w.tabbingMode = NSWindowTabbingModeDisallowed;
    [w setFrameAutosaveName:@"CoursAlbertMain"];
    if (![w setFrameUsingName:@"CoursAlbertMain"]) [w center];
    NSVisualEffectView *fx = [[NSVisualEffectView alloc] initWithFrame:w.contentView.bounds];
    fx.material = NSVisualEffectMaterialSidebar; fx.blendingMode = NSVisualEffectBlendingModeBehindWindow; fx.state = NSVisualEffectStateFollowsWindowActiveState;
    fx.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    w.contentView = fx;
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    [config.userContentController addScriptMessageHandler:self name:@"coursAlbert"];
    config.preferences.javaScriptCanOpenWindowsAutomatically = NO;
    if (@available(macOS 12.3, *)) config.preferences.elementFullscreenEnabled = YES;
    WKWebView *web = [[WKWebView alloc] initWithFrame:fx.bounds configuration:config];
    web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    web.navigationDelegate = self;
    web.UIDelegate = self;
    web.allowsBackForwardNavigationGestures = NO;
    if (@available(macOS 13.3, *)) web.inspectable = YES;
    self.vibrancy = NO;
    @try { [web setValue:@NO forKey:@"drawsBackground"]; self.vibrancy = YES; } @catch (NSException *e) { self.vibrancy = NO; }
    [fx addSubview:web];
    DragStrip *strip = [[DragStrip alloc] initWithFrame:NSMakeRect(0, NSHeight(fx.bounds) - 38, NSWidth(fx.bounds), 38)];
    strip.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin;
    [fx addSubview:strip];
    self.window = w; self.webView = web; self.uiLoaded = NO;
    [self applyZoom];
    // L’interface est servie par le serveur local (caméra, micro et partage y fonctionnent) ; sinon, copie locale en secours.
    [self startSpacesServer];
    if (self.serverReady || (!self.server.isRunning && self.serverError)) [self loadUI];
    else {
        __weak typeof(self) weak = self;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(6 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            AppController *me = weak;
            if (!me || me.webView != web || me.uiLoaded) return;
            if (!me.serverError) me.serverError = @"Le serveur des espaces met du temps à démarrer. Les espaces seront disponibles dès qu’il sera prêt.";
            [me loadUI];
        });
    }
}
- (void)loadUI {
    if (!self.webView) return;
    self.uiLoaded = YES; self.uiReady = NO;
    if (self.serverReady && self.serverPort) {
        NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%@/app/index.html", self.serverPort]];
        self.loadedURL = url;
        [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
    } else {
        NSString *ui = [self resource:@"ui"];
        NSURL *url = [NSURL fileURLWithPath:[ui stringByAppendingPathComponent:@"index.html"]];
        self.loadedURL = url;
        [self.webView loadFileURL:url allowingReadAccessToURL:[NSURL fileURLWithPath:ui isDirectory:YES]];
    }
}

#pragma mark Menus

- (NSMenuItem *)item:(NSString *)title action:(SEL)action key:(NSString *)key mods:(NSEventModifierFlags)mods target:(id)target {
    NSMenuItem *i = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key ?: @""];
    i.keyEquivalentModifierMask = mods; i.target = target; return i;
}
- (void)buildMainMenu {
    NSMenu *bar = [NSMenu new];
    NSMenuItem *appItem = [NSMenuItem new]; NSMenu *app = [[NSMenu alloc] initWithTitle:@"Cours Albert"];
    [app addItem:[self item:@"À propos de Cours Albert" action:@selector(orderFrontStandardAboutPanel:) key:@"" mods:0 target:NSApp]];
    [app addItem:NSMenuItem.separatorItem];
    NSMenuItem *prefs = [self item:@"Réglages…" action:@selector(menuNavigate:) key:@"," mods:NSEventModifierFlagCommand target:self]; prefs.representedObject = @"reglages"; [app addItem:prefs];
    [app addItem:NSMenuItem.separatorItem];
    [app addItem:[self item:@"Masquer Cours Albert" action:@selector(hide:) key:@"h" mods:NSEventModifierFlagCommand target:NSApp]];
    [app addItem:[self item:@"Masquer les autres" action:@selector(hideOtherApplications:) key:@"h" mods:NSEventModifierFlagCommand | NSEventModifierFlagOption target:NSApp]];
    [app addItem:[self item:@"Tout afficher" action:@selector(unhideAllApplications:) key:@"" mods:0 target:NSApp]];
    [app addItem:NSMenuItem.separatorItem];
    [app addItem:[self item:@"Quitter Cours Albert" action:@selector(terminate:) key:@"q" mods:NSEventModifierFlagCommand target:NSApp]];
    appItem.submenu = app; [bar addItem:appItem];

    NSMenuItem *fileItem = [NSMenuItem new]; NSMenu *file = [[NSMenu alloc] initWithTitle:@"Fichier"];
    NSArray *commands = @[@[@"Nouveau tableau", @"new-board", @"n", @(NSEventModifierFlagCommand)], @[@"Nouvel espace libre", @"new-canvas", @"n", @(NSEventModifierFlagCommand | NSEventModifierFlagShift)], @[@"Modèles…", @"templates", @"", @0], @[@"Importer un espace…", @"import", @"", @0], @[@"Rejoindre un espace partagé…", @"join", @"", @0]];
    for (NSArray *c in commands) { NSMenuItem *i = [self item:c[0] action:@selector(menuCommand:) key:c[2] mods:[c[3] unsignedIntegerValue] target:self]; i.representedObject = c[1]; [file addItem:i]; }
    [file addItem:[self item:@"Ouvrir un fichier texte ou Markdown…" action:@selector(menuOpenText:) key:@"o" mods:NSEventModifierFlagCommand target:self]];
    [file addItem:NSMenuItem.separatorItem];
    [file addItem:[self item:@"Synchroniser maintenant" action:@selector(menuSync:) key:@"r" mods:NSEventModifierFlagCommand target:self]];
    [file addItem:[self item:@"Rechercher…" action:@selector(menuSearch:) key:@"k" mods:NSEventModifierFlagCommand target:self]];
    [file addItem:[self item:@"Ouvrir mes cours dans le Finder" action:@selector(menuOpenCourses:) key:@"o" mods:NSEventModifierFlagCommand | NSEventModifierFlagShift target:self]];
    [file addItem:[self item:@"Exporter l’emploi du temps (.ics)" action:@selector(menuICS:) key:@"" mods:0 target:self]];
    [file addItem:NSMenuItem.separatorItem];
    [file addItem:[self item:@"Fermer la fenêtre" action:@selector(performClose:) key:@"w" mods:NSEventModifierFlagCommand target:nil]];
    fileItem.submenu = file; [bar addItem:fileItem];

    NSMenuItem *editItem = [NSMenuItem new]; NSMenu *edit = [[NSMenu alloc] initWithTitle:@"Édition"];
    [edit addItem:[self item:@"Annuler" action:NSSelectorFromString(@"undo:") key:@"z" mods:NSEventModifierFlagCommand target:nil]];
    [edit addItem:[self item:@"Rétablir" action:NSSelectorFromString(@"redo:") key:@"z" mods:NSEventModifierFlagCommand | NSEventModifierFlagShift target:nil]];
    [edit addItem:NSMenuItem.separatorItem];
    [edit addItem:[self item:@"Couper" action:@selector(cut:) key:@"x" mods:NSEventModifierFlagCommand target:nil]];
    [edit addItem:[self item:@"Copier" action:@selector(copy:) key:@"c" mods:NSEventModifierFlagCommand target:nil]];
    [edit addItem:[self item:@"Coller" action:@selector(paste:) key:@"v" mods:NSEventModifierFlagCommand target:nil]];
    [edit addItem:[self item:@"Tout sélectionner" action:@selector(selectAll:) key:@"a" mods:NSEventModifierFlagCommand target:nil]];
    editItem.submenu = edit; [bar addItem:editItem];

    NSMenuItem *viewItem = [NSMenuItem new]; NSMenu *view = [[NSMenu alloc] initWithTitle:@"Présentation"];
    NSMenuItem *home = [self item:@"Accueil des espaces" action:@selector(menuNavigate:) key:@"" mods:0 target:self]; home.representedObject = @"accueil"; [view addItem:home];
    [view addItem:NSMenuItem.separatorItem];
    NSArray *routes = @[@[@"Aujourd’hui", @"today", @"1"], @[@"Emploi du temps", @"planning", @"2"], @[@"Examens", @"examens", @"3"], @[@"Présence", @"absences", @"4"], @[@"Cours", @"cours", @"5"], @[@"Synchronisation", @"sync", @"6"]];
    for (NSArray *r in routes) { NSMenuItem *i = [self item:r[0] action:@selector(menuNavigate:) key:r[2] mods:NSEventModifierFlagCommand target:self]; i.representedObject = r[1]; [view addItem:i]; }
    [view addItem:NSMenuItem.separatorItem];
    NSMenuItem *present = [self item:@"Présenter l’espace ouvert" action:@selector(menuCommand:) key:@"p" mods:NSEventModifierFlagCommand | NSEventModifierFlagOption target:self]; present.representedObject = @"present"; [view addItem:present];
    NSMenuItem *share = [self item:@"Partager l’espace ouvert…" action:@selector(menuCommand:) key:@"" mods:0 target:self]; share.representedObject = @"share"; [view addItem:share];
    [view addItem:NSMenuItem.separatorItem];
    // Taille de toute l’interface (utile sur les grands écrans) : ⌘+, ⌘−, ⌘0 ; mémorisée pour les prochains lancements.
    NSArray *zooms = @[@[@"Agrandir l’interface", @"+", @"in"], @[@"Réduire l’interface", @"-", @"out"], @[@"Taille réelle", @"0", @"reset"]];
    for (NSArray *z in zooms) { NSMenuItem *i = [self item:z[0] action:@selector(menuZoom:) key:z[1] mods:NSEventModifierFlagCommand target:self]; i.representedObject = z[2]; [view addItem:i]; }
    NSMenuItem *zoomAlt = [self item:@"Agrandir l’interface" action:@selector(menuZoom:) key:@"=" mods:NSEventModifierFlagCommand target:self];
    zoomAlt.representedObject = @"in"; zoomAlt.hidden = YES; zoomAlt.allowsKeyEquivalentWhenHidden = YES; [view addItem:zoomAlt];
    [view addItem:NSMenuItem.separatorItem];
    [view addItem:[self item:@"Recharger l’interface" action:@selector(menuReload:) key:@"r" mods:NSEventModifierFlagCommand | NSEventModifierFlagOption target:self]];
    viewItem.submenu = view; [bar addItem:viewItem];

    NSMenuItem *windowItem = [NSMenuItem new]; NSMenu *window = [[NSMenu alloc] initWithTitle:@"Fenêtre"];
    [window addItem:[self item:@"Réduire" action:@selector(performMiniaturize:) key:@"m" mods:NSEventModifierFlagCommand target:nil]];
    [window addItem:[self item:@"Zoom" action:@selector(performZoom:) key:@"" mods:0 target:nil]];
    windowItem.submenu = window; [bar addItem:windowItem]; NSApp.windowsMenu = window;

    NSMenuItem *helpItem = [NSMenuItem new]; NSMenu *help = [[NSMenu alloc] initWithTitle:@"Aide"];
    [help addItem:[self item:@"Guide de démarrage" action:@selector(menuGuide:) key:@"" mods:0 target:self]];
    helpItem.submenu = help; [bar addItem:helpItem]; NSApp.helpMenu = help;
    NSApp.mainMenu = bar;
}
- (void)navigate:(NSString *)route {
    [self showWindow];
    if (self.uiReady) [self send:@{@"type": @"navigate", @"route": route}];
    else self.pendingRoute = route;
}
- (void)menuNavigate:(NSMenuItem *)sender { [self navigate:sender.representedObject]; }
- (void)menuSync:(id)sender { [self startSync:@"normal"]; }
- (void)menuSearch:(id)sender { [self showWindow]; if (self.uiReady) [self send:@{@"type": @"search"}]; }
- (void)menuOpenCourses:(id)sender { [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:[[self settings][@"vaultCourses"] stringByAppendingPathComponent:@"Cours"]]]; }
- (void)menuICS:(id)sender { NSString *e = [self openICS]; if (e) [self alert:e]; }
- (void)menuGuide:(id)sender { [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:[self resource:@"Guide de démarrage.html"]]]; }
- (void)menuReload:(id)sender { if (!self.webView) return; self.uiLoaded = NO; [self loadUI]; }
- (double)storedZoom { double z = [NSUserDefaults.standardUserDefaults doubleForKey:@"pageZoom"]; return (z >= 0.5 && z <= 3.0) ? z : 1.0; }
- (void)applyZoom { if (self.webView) self.webView.pageZoom = [self storedZoom]; }
- (void)menuZoom:(NSMenuItem *)sender {
    double z = [self storedZoom];
    NSString *kind = sender.representedObject;
    if ([kind isEqualToString:@"in"]) z = MIN(2.5, round((z + 0.1) * 10.0) / 10.0);
    else if ([kind isEqualToString:@"out"]) z = MAX(0.6, round((z - 0.1) * 10.0) / 10.0);
    else z = 1.0;
    [NSUserDefaults.standardUserDefaults setDouble:z forKey:@"pageZoom"];
    [self applyZoom];
}
- (void)menuCommand:(NSMenuItem *)sender {
    [self showWindow];
    [self deliver:@{@"type": @"command", @"name": sender.representedObject ?: @""}];
}
- (void)menuOpenText:(id)sender {
    [self showWindow];
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = YES; panel.canChooseDirectories = NO; panel.allowsMultipleSelection = YES;
    panel.message = @"Choisissez des notes Markdown ou des fichiers texte à ouvrir dans Cours Albert.";
    NSMutableArray *types = [NSMutableArray arrayWithObject:UTTypePlainText];
    for (NSString *ext in @[@"md", @"markdown", @"csv", @"tsv", @"json", @"ipynb", @"py", @"r", @"sql", @"tex", @"bib", @"yaml", @"yml", @"txt"]) { UTType *t = [UTType typeWithFilenameExtension:ext]; if (t) [types addObject:t]; }
    panel.allowedContentTypes = types;
    NSString *library = [[self settings][@"vaultCourses"] stringByAppendingPathComponent:@"Cours"];
    if ([NSFileManager.defaultManager fileExistsAtPath:library]) panel.directoryURL = [NSURL fileURLWithPath:library];
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r) {
        if (r != NSModalResponseOK) return;
        [self application:NSApp openURLs:panel.URLs];
    }];
}
- (void)alert:(NSString *)message { NSAlert *a = [NSAlert new]; a.messageText = @"Cours Albert"; a.informativeText = message; [a runModal]; }

#pragma mark Pont JavaScript

- (void)send:(NSDictionary *)message {
    if (!self.webView) return;
    if (![NSJSONSerialization isValidJSONObject:message]) return;
    NSData *json = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
    if (!json) return;
    NSString *script = [NSString stringWithFormat:@"window.CoursAlbert && window.CoursAlbert.receive(%@);", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]];
    [self.webView evaluateJavaScript:script completionHandler:nil];
}
- (void)reply:(NSNumber *)rid result:(id)result error:(NSString *)error {
    [self send:@{@"type": @"reply", @"id": rid ?: @0, @"ok": @(error == nil), @"result": result ?: NSNull.null, @"error": error ?: @""}];
}
- (NSDictionary *)progressDictionary {
    if (!self.engine.isRunning && ![self engineRunningElsewhere]) return nil;
    return [self readJSON:[self supportFile:@"progress.json"]];
}
- (void)sendInit {
    [UNUserNotificationCenter.currentNotificationCenter getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *ns) {
        dispatch_async(dispatch_get_main_queue(), ^{
            NSMutableDictionary *m = [NSMutableDictionary dictionaryWithDictionary:@{@"type": @"init", @"settings": [self settings], @"env": [self envWithNotifications:[self notificationStatus:ns.authorizationStatus]], @"log": [self logText]}];
            NSDictionary *data = [self data]; if (data) m[@"data"] = data;
            NSDictionary *p = [self progressDictionary]; if (p) m[@"progress"] = p;
            NSDictionary *classement = [self readJSON:[self supportFile:@"classement.json"]]; if (classement) m[@"classement"] = classement;
            [self send:m];
            self.uiReady = YES;
            if (self.pendingRoute) { [self send:@{@"type": @"navigate", @"route": self.pendingRoute}]; self.pendingRoute = nil; }
            NSArray *queued = self.pendingOpen; self.pendingOpen = nil;
            for (NSDictionary *q in queued) [self send:q];
        });
    }];
}
- (void)pushData { NSDictionary *d = [self data]; if (d) [self send:@{@"type": @"data", @"data": d}]; [self refreshStatusItem]; }

- (BOOL)allowedPath:(NSString *)path {
    if (!path.length) return NO;
    NSString *p = path.stringByStandardizingPath;
    NSDictionary *s = [self settings];
    NSMutableArray *roots = [NSMutableArray arrayWithObjects:self.supportDir, s[@"vaultCourses"], s[@"desktopCourses"], [self resource:@""], nil];
    for (NSString *d in s[@"driveFolders"]) [roots addObject:d];
    NSString *vault = [self vaultRootFor:s[@"vaultCourses"]]; if (vault) [roots addObject:vault];
    // Dossiers de notes ajoutés dans l’app (3.1)
    NSDictionary *prefs = [self readJSON:[[self.supportDir stringByAppendingPathComponent:@"Espaces"] stringByAppendingPathComponent:@"preferences.json"]];
    NSArray *noteFolders = [prefs isKindOfClass:NSDictionary.class] && [prefs[@"noteFolders"] isKindOfClass:NSArray.class] ? prefs[@"noteFolders"] : @[];
    for (NSDictionary *f in noteFolders) if ([f isKindOfClass:NSDictionary.class] && [f[@"path"] isKindOfClass:NSString.class] && ((NSString *)f[@"path"]).length > 1) [roots addObject:f[@"path"]];
    if ([self.sessionPaths containsObject:p]) return YES;
    for (NSString *root in roots) {
        NSString *r = [root stringByStandardizingPath];
        if (r.length > 1 && ([p isEqualToString:r] || [p hasPrefix:[r stringByAppendingString:@"/"]])) return YES;
    }
    return NO;
}
- (NSString *)openICS {
    NSString *ics = [[self settings][@"vaultCourses"] stringByAppendingPathComponent:@"Emploi du temps Albert.ics"];
    if (![NSFileManager.defaultManager fileExistsAtPath:ics]) return @"Le calendrier sera créé après la prochaine synchronisation avec Inside.";
    [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:ics]];
    return nil;
}

- (BOOL)trustedOrigin:(WKSecurityOrigin *)origin {
    if ([origin.protocol isEqualToString:@"file"]) return [self.loadedURL isFileURL];
    if (![origin.protocol isEqualToString:@"http"] || ![origin.host isEqualToString:@"127.0.0.1"]) return NO;
    return (self.serverPort && origin.port == self.serverPort.integerValue) || (self.loadedURL.port && origin.port == self.loadedURL.port.integerValue);
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:NSDictionary.class]) return;
    // Seule la page principale de l’app parle à la partie native (jamais une vidéo intégrée ni un espace d’un autre Mac).
    if (!message.frameInfo.isMainFrame || ![self trustedOrigin:message.frameInfo.securityOrigin]) return;
    NSDictionary *m = message.body;
    NSNumber *rid = [m[@"id"] isKindOfClass:NSNumber.class] ? m[@"id"] : @0;
    NSString *action = m[@"action"];
    NSFileManager *fm = NSFileManager.defaultManager;
    if ([action isEqualToString:@"ready"]) { [self sendInit]; [self reply:rid result:nil error:nil]; }
    else if ([action isEqualToString:@"sync"]) { NSString *e = [self startSync:m[@"mode"] ?: @"normal"]; [self reply:rid result:@YES error:e]; }
    else if ([action isEqualToString:@"open"] || [action isEqualToString:@"reveal"]) {
        NSString *path = m[@"path"];
        if (![self allowedPath:path]) { [self reply:rid result:nil error:@"Ce fichier est en dehors de la bibliothèque de cours."]; return; }
        if (![fm fileExistsAtPath:path]) { [self reply:rid result:nil error:@"Fichier introuvable : lancez une synchronisation."]; return; }
        NSURL *url = [NSURL fileURLWithPath:path];
        if ([action isEqualToString:@"reveal"]) [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[url]];
        else [NSWorkspace.sharedWorkspace openURL:url];
        [self reply:rid result:@YES error:nil];
    }
    else if ([action isEqualToString:@"openURL"]) {
        NSURL *url = [NSURL URLWithString:[m[@"url"] isKindOfClass:NSString.class] ? m[@"url"] : @""];
        NSString *scheme = url.scheme.lowercaseString ?: @"";
        if (![@[@"https", @"http", @"mailto"] containsObject:scheme]) { [self reply:rid result:nil error:@"Adresse non autorisée."]; return; }
        [NSWorkspace.sharedWorkspace openURL:url]; [self reply:rid result:@YES error:nil];
    }
    else if ([action isEqualToString:@"openObsidian"]) {
        NSString *path = [m[@"path"] length] ? m[@"path"] : [[[self settings][@"vaultCourses"] stringByAppendingPathComponent:@"Cours"] stringByAppendingPathComponent:@"Tableau de bord Albert.md"];
        if (![fm fileExistsAtPath:path]) path = [[[self settings][@"vaultCourses"] stringByAppendingPathComponent:@"Cours"] stringByAppendingPathComponent:@"Accueil des cours.md"];
        NSURLComponents *u = [NSURLComponents new]; u.scheme = @"obsidian"; u.host = @"open"; u.queryItems = @[[NSURLQueryItem queryItemWithName:@"path" value:path]];
        BOOL ok = [NSWorkspace.sharedWorkspace openURL:u.URL];
        [self reply:rid result:@(ok) error:ok ? nil : @"Obsidian ne s’est pas ouvert. Vérifiez qu’il est installé et que ce vault y est ouvert."];
    }
    else if ([action isEqualToString:@"openICS"]) { NSString *e = [self openICS]; [self reply:rid result:@(e == nil) error:e]; }
    else if ([action isEqualToString:@"openGuide"]) { [self menuGuide:nil]; [self reply:rid result:@YES error:nil]; }
    else if ([action isEqualToString:@"openSupport"]) { [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:self.supportDir]]; [self reply:rid result:@YES error:nil]; }
    else if ([action isEqualToString:@"readLog"]) { [self reply:rid result:[self logText] error:nil]; }
    else if ([action isEqualToString:@"chooseFolder"]) {
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.canChooseDirectories = YES; panel.canChooseFiles = NO; panel.canCreateDirectories = YES;
        BOOL multiple = [m[@"multiple"] boolValue]; panel.allowsMultipleSelection = multiple;
        NSString *purpose = m[@"purpose"];
        if ([purpose isEqualToString:@"driveFolders"]) {
            panel.message = @"Choisissez les dossiers de cours dans « Mon Drive » (Google Drive pour ordinateur).";
            NSString *cloud = [self.home stringByAppendingPathComponent:@"Library/CloudStorage"];
            if ([fm fileExistsAtPath:cloud]) panel.directoryURL = [NSURL fileURLWithPath:cloud];
        } else if ([purpose isEqualToString:@"vaultCourses"]) panel.message = @"Choisissez le dossier où ranger vos cours (il peut être dans votre vault Obsidian).";
        else if ([purpose isEqualToString:@"notes"]) panel.message = @"Choisissez un dossier de notes (dans votre vault Obsidian ou ailleurs sur le Mac).";
        else panel.message = @"Choisissez le dossier de cours sur le Bureau.";
        [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r) {
            if (r != NSModalResponseOK) { [self reply:rid result:(multiple ? (id)@[] : (id)NSNull.null) error:nil]; return; }
            if (multiple) { NSMutableArray *paths = [NSMutableArray array]; for (NSURL *u in panel.URLs) [paths addObject:u.path]; [self reply:rid result:paths error:nil]; }
            else [self reply:rid result:panel.URL.path error:nil];
        }];
    }
    else if ([action isEqualToString:@"saveSettings"]) {
        NSString *error = nil;
        NSDictionary *saved = [self saveSettings:m[@"settings"] install:[m[@"install"] boolValue] error:&error];
        [self reply:rid result:saved ? @{@"settings": saved, @"env": [self envWithNotifications:nil]} : nil error:error];
        if (saved && [saved[@"notifications"][@"classReminder"] intValue] > 0) [self requestNotificationsThen:nil];
    }
    else if ([action isEqualToString:@"install"]) { NSString *e = [self installForMe]; if (!e) e = [self updateAgents]; [self reply:rid result:@(e == nil) error:e]; }
    else if ([action isEqualToString:@"requestNotifications"]) { [self requestNotificationsThen:^(NSString *status) { [self reply:rid result:status error:nil]; }]; }
    else if ([action isEqualToString:@"saveClassement"]) {
        NSDictionary *d = m[@"data"];
        NSData *json = [d isKindOfClass:NSDictionary.class] && [NSJSONSerialization isValidJSONObject:d] ? [NSJSONSerialization dataWithJSONObject:d options:NSJSONWritingPrettyPrinted error:nil] : nil;
        if (!json || json.length > 5000000) { [self reply:rid result:nil error:@"Classement invalide."]; return; }
        BOOL ok = [json writeToFile:[self supportFile:@"classement.json"] atomically:YES];
        [self reply:rid result:@(ok) error:ok ? nil : @"Impossible d’enregistrer le classement des cours."];
    }
    else if ([action isEqualToString:@"saveURL"]) [self saveURL:m[@"url"] suggested:m[@"suggested"] reply:rid];
    else if ([action isEqualToString:@"exportPDF"]) [self exportPDF:m[@"suggested"] reply:rid];
    else if ([action isEqualToString:@"exportImage"]) [self exportImage:m[@"suggested"] reply:rid];
    else if ([action isEqualToString:@"notify"]) { [self notifyTitle:m[@"title"] body:m[@"body"] route:m[@"route"]]; [self reply:rid result:@YES error:nil]; }
    else [self reply:rid result:nil error:[NSString stringWithFormat:@"Action inconnue : %@", action]];
}

- (BOOL)isAppURL:(NSURL *)url {
    if (url.isFileURL) return [url.path hasPrefix:[self resource:@"ui"]];
    if (![url.scheme isEqualToString:@"http"] || ![url.host isEqualToString:@"127.0.0.1"] || ![url.path hasPrefix:@"/app/"]) return NO;
    return (self.serverPort && url.port.integerValue == self.serverPort.integerValue) || (self.loadedURL.port && url.port.integerValue == self.loadedURL.port.integerValue);
}
- (void)openExternal:(NSURL *)url {
    NSString *scheme = url.scheme.lowercaseString ?: @"";
    if ([@[@"https", @"http", @"mailto"] containsObject:scheme]) [NSWorkspace.sharedWorkspace openURL:url];
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = action.request.URL;
    // Cadres intégrés (vidéos, espaces rejoints sur un autre Mac) : ils restent isolés du pont natif.
    if (action.targetFrame && !action.targetFrame.isMainFrame) { decisionHandler(WKNavigationActionPolicyAllow); return; }
    if ([self isAppURL:url]) { decisionHandler(WKNavigationActionPolicyAllow); return; }
    [self openExternal:url];
    decisionHandler(WKNavigationActionPolicyCancel);
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView { [webView reload]; }
- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
    [self openExternal:action.request.URL];
    return nil;
}
- (void)webView:(WKWebView *)webView runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))completionHandler {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = YES; panel.canChooseDirectories = parameters.allowsDirectories; panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    if (!self.window) { completionHandler(nil); return; }
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r) { completionHandler(r == NSModalResponseOK ? panel.URLs : nil); }];
}
- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision))decisionHandler API_AVAILABLE(macos(12.0)) {
    // Photo, vidéo et message audio des espaces : seulement pour la page de l’app (macOS demande ensuite l’accord).
    decisionHandler(frame.isMainFrame && [self trustedOrigin:origin] ? WKPermissionDecisionGrant : WKPermissionDecisionDeny);
}
- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    if (frame.isMainFrame) [self alert:message];
    completionHandler();
}
- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
    if (!frame.isMainFrame) { completionHandler(NO); return; }
    NSAlert *a = [NSAlert new]; a.messageText = @"Cours Albert"; a.informativeText = message;
    [a addButtonWithTitle:@"OK"]; [a addButtonWithTitle:@"Annuler"];
    completionHandler([a runModal] == NSAlertFirstButtonReturn);
}

#pragma mark Serveur des espaces collaboratifs

- (NSString *)randomToken {
    uint8_t bytes[24]; arc4random_buf(bytes, sizeof bytes);
    NSMutableString *t = [NSMutableString stringWithCapacity:48];
    for (size_t i = 0; i < sizeof bytes; i++) [t appendFormat:@"%02x", bytes[i]];
    return t;
}
- (NSArray *)libraryRoots {
    NSDictionary *s = [self settings];
    NSMutableArray *roots = [NSMutableArray array];
    for (id p in @[s[@"vaultCourses"] ?: @"", s[@"desktopCourses"] ?: @""]) if ([p isKindOfClass:NSString.class] && [p length]) [roots addObject:[p stringByStandardizingPath]];
    for (id d in s[@"driveFolders"]) if ([d isKindOfClass:NSString.class] && [d length]) [roots addObject:[d stringByStandardizingPath]];
    NSString *vault = [self vaultRootFor:s[@"vaultCourses"]]; if (vault) [roots addObject:vault];
    return roots;
}
- (BOOL)spacesLanWanted {
    NSDictionary *prefs = [self readJSON:[[self supportFile:@"Espaces"] stringByAppendingPathComponent:@"preferences.json"]];
    return [prefs[@"lan"] boolValue];
}
- (void)startSpacesServer {
    if (self.server.isRunning || self.quitting) return;
    NSString *script = [self resource:@"espaces/server.mjs"];
    if (![NSFileManager.defaultManager fileExistsAtPath:script]) { self.serverError = @"Le serveur des espaces est absent de l’application. Réinstallez Cours Albert."; [self spacesStateChanged]; return; }
    if (!self.serverToken) self.serverToken = [self randomToken];
    NSMutableArray *args = [NSMutableArray arrayWithObjects:script, @"--support", self.supportDir, @"--ui", [self resource:@"ui"], nil];
    if (self.serverPort) [args addObjectsFromArray:@[@"--port", self.serverPort.stringValue]];
    self.serverRoots = [self libraryRoots];
    NSString *vault = [self vaultRootFor:[self settings][@"vaultCourses"]];
    for (NSString *root in self.serverRoots) if (![root isEqualToString:vault]) [args addObjectsFromArray:@[@"--allow", root]];
    if (vault) [args addObjectsFromArray:@[@"--vault", vault]];
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:[self nodePath]];
    task.arguments = args;
    task.currentDirectoryURL = [NSURL fileURLWithPath:self.supportDir];
    NSMutableDictionary *env = [NSMutableDictionary dictionaryWithDictionary:NSProcessInfo.processInfo.environment];
    env[@"CA_TOKEN"] = self.serverToken;
    [env removeObjectForKey:@"NODE_OPTIONS"];
    task.environment = env;
    NSPipe *input = [NSPipe pipe], *output = [NSPipe pipe];
    task.standardInput = input; task.standardOutput = output;
    NSString *errors = [self supportFile:@"espaces-erreurs.log"];
    if ([[NSFileManager.defaultManager attributesOfItemAtPath:errors error:nil] fileSize] > 1000000) [NSFileManager.defaultManager removeItemAtPath:errors error:nil];
    if (![NSFileManager.defaultManager fileExistsAtPath:errors]) [NSFileManager.defaultManager createFileAtPath:errors contents:nil attributes:nil];
    NSFileHandle *err = [NSFileHandle fileHandleForWritingAtPath:errors]; [err seekToEndOfFile];
    task.standardError = err ?: NSFileHandle.fileHandleWithNullDevice;
    self.serverOut = [NSMutableData data];
    __weak typeof(self) weak = self;
    output.fileHandleForReading.readabilityHandler = ^(NSFileHandle *h) {
        NSData *d = h.availableData;
        if (!d.length) { h.readabilityHandler = nil; return; }
        dispatch_async(dispatch_get_main_queue(), ^{ [weak serverOutput:d from:task]; });
    };
    task.terminationHandler = ^(NSTask *t) {
        int code = t.terminationStatus;
        dispatch_async(dispatch_get_main_queue(), ^{ [err closeFile]; [weak serverTerminated:t code:code]; });
    };
    NSError *error = nil;
    self.serverReady = NO;
    if (![task launchAndReturnError:&error]) {
        [err closeFile];
        self.serverError = [NSString stringWithFormat:@"Le serveur des espaces n’a pas démarré : %@", error.localizedDescription];
        [self spacesStateChanged];
        return;
    }
    self.server = task; self.serverInput = input.fileHandleForWriting;
}
- (void)serverOutput:(NSData *)data from:(NSTask *)task {
    if (task != self.server) return;
    [self.serverOut appendData:data];
    NSData *newline = [NSData dataWithBytes:"\n" length:1];
    for (NSRange r = [self.serverOut rangeOfData:newline options:0 range:NSMakeRange(0, self.serverOut.length)]; r.location != NSNotFound; r = [self.serverOut rangeOfData:newline options:0 range:NSMakeRange(0, self.serverOut.length)]) {
        NSData *line = [self.serverOut subdataWithRange:NSMakeRange(0, r.location)];
        [self.serverOut replaceBytesInRange:NSMakeRange(0, r.location + 1) withBytes:NULL length:0];
        NSDictionary *m = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
        if (![m isKindOfClass:NSDictionary.class] || ![m[@"ready"] boolValue] || ![m[@"port"] isKindOfClass:NSNumber.class]) continue;
        self.serverPort = m[@"port"];
        self.serverLanPort = [m[@"lanPort"] isKindOfClass:NSNumber.class] ? m[@"lanPort"] : nil;
        self.serverReady = YES; self.serverError = nil;
        [self spacesStateChanged];
    }
    if (self.serverOut.length > 65536) self.serverOut.length = 0;
}
- (void)serverTerminated:(NSTask *)task code:(int)code {
    if (task != self.server) return;
    self.server = nil; self.serverInput = nil; self.serverReady = NO;
    if (self.quitting) return;
    NSDate *now = NSDate.date;
    if (!self.serverRestarts) self.serverRestarts = [NSMutableArray array];
    [self.serverRestarts filterUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDate *d, NSDictionary *b) { return [now timeIntervalSinceDate:d] < 600; }]];
    if (self.serverRestarts.count >= 5) {
        self.serverError = @"Le serveur des espaces s’est arrêté plusieurs fois. Relancez Cours Albert ; le détail est dans espaces.log (Réglages › Espaces).";
        [self spacesStateChanged];
        return;
    }
    [self.serverRestarts addObject:now];
    self.serverError = [NSString stringWithFormat:@"Le serveur des espaces redémarre (code %d)…", code];
    [self spacesStateChanged];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ [self startSpacesServer]; });
}
- (void)restartSpacesServerIfRootsChanged {
    if ([[self libraryRoots] isEqualToArray:self.serverRoots ?: @[]] || !self.server.isRunning) return;
    // Les dossiers de cours ont changé : le serveur repart avec les nouveaux dossiers autorisés (même port, même jeton).
    NSTask *old = self.server;
    self.server = nil; self.serverInput = nil; self.serverReady = NO;
    old.terminationHandler = nil;
    [old terminate];
    __block int ticks = 0;
    NSTimer *wait = [NSTimer timerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *t) {
        if (old.isRunning && ++ticks < 40) return;
        [t invalidate];
        [self startSpacesServer];
    }];
    [NSRunLoop.mainRunLoop addTimer:wait forMode:NSRunLoopCommonModes];
}
- (NSDictionary *)spacesInfo {
    NSMutableDictionary *d = [NSMutableDictionary dictionaryWithDictionary:@{@"folder": [self supportFile:@"Espaces"]}];
    if (self.serverReady && self.serverPort && self.serverToken) {
        d[@"port"] = self.serverPort; d[@"token"] = self.serverToken;
        NSURL *u = self.loadedURL;
        BOOL samePage = [u.scheme isEqualToString:@"http"] && u.port.integerValue == self.serverPort.integerValue;
        d[@"base"] = samePage ? @"" : [NSString stringWithFormat:@"http://127.0.0.1:%@", self.serverPort];
        if (self.serverLanPort) d[@"lanPort"] = self.serverLanPort;
    } else d[@"error"] = self.serverError ?: @"Le serveur des espaces démarre…";
    return d;
}
- (void)spacesStateChanged {
    if (self.webView && !self.uiLoaded) { if (self.serverReady || self.serverError) [self loadUI]; return; }
    if (self.uiReady) [self send:@{@"type": @"spaces", @"spaces": [self spacesInfo]}];
}

#pragma mark Fichiers enregistrés, PDF, images et notifications des espaces

- (NSURL *)serverURLFrom:(id)raw {
    if (![raw isKindOfClass:NSString.class] || ![raw length] || !self.serverPort) return nil;
    NSURL *base = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%@/", self.serverPort]];
    NSURL *u = [NSURL URLWithString:raw relativeToURL:base].absoluteURL;
    if (![u.scheme isEqualToString:@"http"] || ![u.host isEqualToString:@"127.0.0.1"] || u.port.integerValue != self.serverPort.integerValue) return nil;
    return u;
}
- (NSString *)fileNameFrom:(id)name fallback:(NSString *)fallback {
    NSString *n = [name isKindOfClass:NSString.class] ? name : @"";
    n = [[n componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/:\\\n\r\t"]] componentsJoinedByString:@"-"];
    n = [n stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@" ."]];
    if (n.length > 150) n = [n substringToIndex:150];
    return n.length ? n : fallback;
}
- (void)askSavePath:(id)suggested fallback:(NSString *)fallback extension:(NSString *)ext then:(void (^)(NSURL *))done {
    if (!self.window) { done(nil); return; }
    NSSavePanel *panel = [NSSavePanel savePanel];
    panel.nameFieldStringValue = [self fileNameFrom:suggested fallback:fallback];
    panel.canCreateDirectories = YES;
    NSURL *downloads = [NSFileManager.defaultManager URLsForDirectory:NSDownloadsDirectory inDomains:NSUserDomainMask].firstObject;
    if (downloads) panel.directoryURL = downloads;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r) {
        NSURL *url = r == NSModalResponseOK ? panel.URL : nil;
        if (url && ext.length && ![url.pathExtension.lowercaseString isEqualToString:ext]) url = [url URLByAppendingPathExtension:ext];
        done(url);
    }];
}
- (void)saveURL:(id)raw suggested:(id)suggested reply:(NSNumber *)rid {
    NSURL *source = [self serverURLFrom:raw];
    if (!source) { [self reply:rid result:nil error:@"Téléchargement non autorisé."]; return; }
    [self askSavePath:suggested fallback:@"Fichier" extension:nil then:^(NSURL *dest) {
        if (!dest) { [self reply:rid result:NSNull.null error:nil]; return; }
        NSURLSessionDownloadTask *job = [NSURLSession.sharedSession downloadTaskWithURL:source completionHandler:^(NSURL *location, NSURLResponse *response, NSError *error) {
            NSString *problem = nil;
            NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 0;
            if (error) problem = error.localizedDescription;
            else if (status != 200) problem = [NSString stringWithFormat:@"Le fichier n’a pas pu être préparé (erreur %ld).", (long)status];
            else {
                NSError *e = nil;
                [NSFileManager.defaultManager removeItemAtURL:dest error:nil];
                if (![NSFileManager.defaultManager moveItemAtURL:location toURL:dest error:&e]) problem = e.localizedDescription;
            }
            dispatch_async(dispatch_get_main_queue(), ^{ [self reply:rid result:problem ? nil : dest.path error:problem]; });
        }];
        [job resume];
    }];
}
- (void)exportPDF:(id)suggested reply:(NSNumber *)rid {
    [self askSavePath:suggested fallback:@"Espace.pdf" extension:@"pdf" then:^(NSURL *dest) {
        if (!dest || !self.webView) { [self reply:rid result:NSNull.null error:nil]; return; }
        NSPrintInfo *info = [NSPrintInfo.sharedPrintInfo copy];
        info.jobDisposition = NSPrintSaveJob;
        info.dictionary[NSPrintJobSavingURL] = dest;
        info.horizontalPagination = NSPrintingPaginationModeFit;
        info.verticalPagination = NSPrintingPaginationModeAutomatic;
        info.topMargin = info.bottomMargin = 30; info.leftMargin = info.rightMargin = 30;
        info.horizontallyCentered = NO; info.verticallyCentered = NO;
        NSPrintOperation *op = [self.webView printOperationWithPrintInfo:info];
        op.showsPrintPanel = NO; op.showsProgressPanel = NO;
        op.view.frame = self.webView.bounds;
        self.printReply = rid; self.printDest = dest.path;
        [op runOperationModalForWindow:self.window delegate:self didRunSelector:@selector(printOperationDidRun:success:contextInfo:) contextInfo:NULL];
    }];
}
- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)contextInfo {
    NSNumber *rid = self.printReply; NSString *dest = self.printDest;
    self.printReply = nil; self.printDest = nil;
    BOOL ok = success && [NSFileManager.defaultManager fileExistsAtPath:dest];
    [self reply:rid result:ok ? dest : nil error:ok ? nil : @"L’export PDF a échoué."];
}
- (void)exportImage:(id)suggested reply:(NSNumber *)rid {
    [self askSavePath:suggested fallback:@"Espace.png" extension:@"png" then:^(NSURL *dest) {
        if (!dest || !self.webView) { [self reply:rid result:NSNull.null error:nil]; return; }
        [self.webView createPDFWithConfiguration:[WKPDFConfiguration new] completionHandler:^(NSData *pdf, NSError *error) {
            NSPDFImageRep *rep = pdf ? [NSPDFImageRep imageRepWithData:pdf] : nil;
            if (!rep) { [self reply:rid result:nil error:@"L’image n’a pas pu être créée."]; return; }
            NSRect b = rep.bounds;
            CGFloat scale = 2, maxSide = 16000;
            if (b.size.height * scale > maxSide) scale = maxSide / b.size.height;
            if (b.size.width * scale > maxSide) scale = MIN(scale, maxSide / b.size.width);
            NSInteger w = MAX(1, (NSInteger)ceil(b.size.width * scale)), h = MAX(1, (NSInteger)ceil(b.size.height * scale));
            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:w pixelsHigh:h bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
            [NSGraphicsContext saveGraphicsState];
            NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
            [NSColor.whiteColor setFill]; NSRectFill(NSMakeRect(0, 0, w, h));
            [rep drawInRect:NSMakeRect(0, 0, w, h)];
            [NSGraphicsContext restoreGraphicsState];
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            BOOL ok = png && [png writeToURL:dest atomically:YES];
            [self reply:rid result:ok ? dest.path : nil error:ok ? nil : @"Impossible d’enregistrer l’image."];
        }];
    }];
}
- (void)notifyTitle:(id)title body:(id)body route:(id)route {
    NSString *t = [title isKindOfClass:NSString.class] && [title length] ? title : @"Cours Albert";
    NSString *b = [body isKindOfClass:NSString.class] ? body : @"";
    NSString *r = [route isKindOfClass:NSString.class] && [route length] < 200 ? route : @"accueil";
    if (t.length > 120) t = [t substringToIndex:120];
    if (b.length > 300) b = [b substringToIndex:300];
    [UNUserNotificationCenter.currentNotificationCenter getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        if (settings.authorizationStatus != UNAuthorizationStatusAuthorized && settings.authorizationStatus != UNAuthorizationStatusProvisional) return;
        UNMutableNotificationContent *c = [UNMutableNotificationContent new];
        c.title = t; c.body = b; c.sound = UNNotificationSound.defaultSound; c.userInfo = @{@"route": r};
        c.threadIdentifier = @"espaces";
        [UNUserNotificationCenter.currentNotificationCenter addNotificationRequest:[UNNotificationRequest requestWithIdentifier:[@"ca-esp-" stringByAppendingString:NSUUID.UUID.UUIDString] content:c trigger:nil] withCompletionHandler:nil];
    }];
}

#pragma mark Réglages, installation et agents

- (NSDictionary *)saveSettings:(NSDictionary *)incoming install:(BOOL)install error:(NSString **)error {
    if (![incoming isKindOfClass:NSDictionary.class]) { *error = @"Réglages invalides."; return nil; }
    NSMutableDictionary *s = [self settings];
    for (NSString *key in @[@"vaultCourses", @"vaultEnabled", @"desktopCourses", @"driveFolders", @"academicYearStart", @"automatic", @"menubar", @"launchAtLogin"]) if (incoming[key] && incoming[key] != NSNull.null) s[key] = incoming[key];
    if ([incoming[@"notifications"] isKindOfClass:NSDictionary.class]) { NSMutableDictionary *n = [s[@"notifications"] mutableCopy]; [n addEntriesFromDictionary:incoming[@"notifications"]]; s[@"notifications"] = n; }
    NSInteger year = [s[@"academicYearStart"] integerValue];
    if (year < 2020 || year > 2100) { *error = @"Indiquez l’année de début du cursus, par exemple 2026."; return nil; }
    if (![s[@"vaultCourses"] length]) { *error = @"Choisissez un dossier pour la bibliothèque de cours."; return nil; }
    for (NSString *p in s[@"driveFolders"]) if (![NSFileManager.defaultManager fileExistsAtPath:p]) { *error = [NSString stringWithFormat:@"Le dossier Drive « %@ » n’est pas accessible. Ouvrez Google Drive pour ordinateur.", p.lastPathComponent]; return nil; }
    NSString *folders = [self ensureCourseFolders:s[@"vaultCourses"] desktop:s[@"desktopCourses"]];
    if (folders) { *error = folders; return nil; }
    s[@"insideBase"] = @"https://inside.albertschool.com";
    s[@"chromeProfile"] = [self supportFile:@"Chrome"];
    NSMutableDictionary *merged = [NSMutableDictionary dictionaryWithDictionary:[self readJSON:self.configPath] ?: @{}];
    [merged addEntriesFromDictionary:s];
    if (![self writeJSON:merged to:self.configPath]) { *error = @"Impossible d’enregistrer la configuration."; return nil; }
    [self writeJSON:merged to:self.favoritePath];
    if (install || ![self installedAppPath]) { NSString *e = [self installForMe]; if (e) { *error = e; return nil; } }
    NSString *agents = [self updateAgents];
    if (agents) { *error = agents; return nil; }
    if ([s[@"menubar"] boolValue]) [self setupStatusItem]; else [self removeStatusItem];
    [self scheduleRemindersWait:NO];
    [self restartSpacesServerIfRootsChanged];
    return [self settings];
}
- (NSString *)ensureCourseFolders:(NSString *)root desktop:(NSString *)desktop {
    NSFileManager *fm = NSFileManager.defaultManager; NSError *error = nil;
    for (NSString *folder in @[root, desktop, [root stringByAppendingPathComponent:@"Cours/S1"], [root stringByAppendingPathComponent:@"Cours/S2"], [root stringByAppendingPathComponent:@"Cours/À classer"], [root stringByAppendingPathComponent:@"Ressources synchronisées"]]) {
        if (![fm createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:&error]) return [NSString stringWithFormat:@"Impossible de créer le dossier %@ : %@", folder.lastPathComponent, error.localizedDescription];
    }
    NSString *link = [desktop stringByAppendingPathComponent:@"Cours synchronisés"], *target = [root stringByAppendingPathComponent:@"Cours"];
    NSString *existing = [fm destinationOfSymbolicLinkAtPath:link error:nil];
    if (existing) { if (![existing isEqualToString:target]) { [fm removeItemAtPath:link error:nil]; [fm createSymbolicLinkAtPath:link withDestinationPath:target error:nil]; } }
    else if (![fm fileExistsAtPath:link]) [fm createSymbolicLinkAtPath:link withDestinationPath:target error:nil];
    return nil;
}
- (NSString *)installForMe {
    if ([self installedAppPath]) return nil;
    NSString *apps = [self.home stringByAppendingPathComponent:@"Applications"];
    [NSFileManager.defaultManager createDirectoryAtPath:apps withIntermediateDirectories:YES attributes:nil error:nil];
    NSError *error = nil;
    if (![NSFileManager.defaultManager copyItemAtPath:NSBundle.mainBundle.bundlePath toPath:[apps stringByAppendingPathComponent:@"Cours Albert.app"] error:&error]) return [NSString stringWithFormat:@"Impossible d’installer l’app : %@", error.localizedDescription];
    return nil;
}
- (NSString *)launchctl:(NSArray *)args {
    NSTask *t = [NSTask new]; t.executableURL = [NSURL fileURLWithPath:@"/bin/launchctl"]; t.arguments = args;
    t.standardOutput = NSFileHandle.fileHandleWithNullDevice; t.standardError = NSFileHandle.fileHandleWithNullDevice;
    NSError *e = nil; if (![t launchAndReturnError:&e]) return e.localizedDescription;
    [t waitUntilExit]; return t.terminationStatus == 0 ? nil : [NSString stringWithFormat:@"code %d", t.terminationStatus];
}
- (NSString *)updateAgents {
    NSDictionary *s = [self settings];
    NSString *dir = [self.home stringByAppendingPathComponent:@"Library/LaunchAgents"];
    [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *appPath = [self installedAppPath] ?: NSBundle.mainBundle.bundlePath;
    NSString *exe = [appPath stringByAppendingPathComponent:@"Contents/MacOS/Cours Albert"];
    NSString *domain = [NSString stringWithFormat:@"gui/%d", getuid()];
    NSString *sync = [dir stringByAppendingPathComponent:[kSyncAgent stringByAppendingString:@".plist"]];
    [self launchctl:@[@"bootout", domain, sync]];
    if ([s[@"automatic"] boolValue]) {
        NSDictionary *plist = @{@"Label": kSyncAgent, @"ProgramArguments": @[exe, @"--background"], @"StartInterval": @3600, @"RunAtLoad": @NO, @"ProcessType": @"Background", @"LowPriorityIO": @YES, @"StandardOutPath": [self supportFile:@"automatic.log"], @"StandardErrorPath": [self supportFile:@"automatic.log"]};
        if (![plist writeToFile:sync atomically:YES]) return @"Impossible d’activer la vérification automatique.";
        NSString *e = [self launchctl:@[@"bootstrap", domain, sync]];
        if (e) return [NSString stringWithFormat:@"La vérification automatique n’a pas démarré (%@). Relancez l’app et réessayez.", e];
    } else [NSFileManager.defaultManager removeItemAtPath:sync error:nil];
    // Ouverture à la connexion : chargée par launchd à la prochaine session, sans lancer une deuxième copie maintenant.
    NSString *login = [dir stringByAppendingPathComponent:[kLoginAgent stringByAppendingString:@".plist"]];
    if ([s[@"launchAtLogin"] boolValue]) {
        NSDictionary *plist = @{@"Label": kLoginAgent, @"ProgramArguments": @[exe, @"--menubar"], @"RunAtLoad": @YES, @"ProcessType": @"Interactive", @"LimitLoadToSessionType": @"Aqua"};
        if (![plist writeToFile:login atomically:YES]) return @"Impossible d’activer l’ouverture à la connexion.";
    } else { [self launchctl:@[@"bootout", domain, login]]; [NSFileManager.defaultManager removeItemAtPath:login error:nil]; }
    return nil;
}

#pragma mark Moteur de synchronisation

- (NSString *)startSync:(NSString *)mode {
    if (self.engine.isRunning) return nil;
    if (![self hasConfig]) { [self navigate:@"bienvenue"]; return @"Configurez d’abord vos dossiers."; }
    if ([self engineRunningElsewhere]) { [self startProgressPolling]; [self send:@{@"type": @"toast", @"text": @"Une synchronisation automatique est déjà en cours : l’app suit sa progression."}]; return nil; }
    NSMutableArray *args = [NSMutableArray arrayWithObjects:[self resource:@"sync.mjs"], @"--config", self.configPath, nil];
    if ([mode isEqualToString:@"login"]) [args addObject:@"--interactive"];
    if ([mode isEqualToString:@"full"]) [args addObject:@"--full"];
    if ([mode isEqualToString:@"login"] || [mode isEqualToString:@"full"]) { if (![NSFileManager.defaultManager fileExistsAtPath:@"/Applications/Google Chrome.app"] && ![NSFileManager.defaultManager fileExistsAtPath:[self.home stringByAppendingPathComponent:@"Applications/Google Chrome.app"]]) return @"Installez Google Chrome pour vous connecter à Inside Albert."; }
    NSString *logPath = [self supportFile:@"manual.log"];
    [NSFileManager.defaultManager createFileAtPath:logPath contents:nil attributes:nil];
    NSFileHandle *log = [NSFileHandle fileHandleForWritingAtPath:logPath];
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:[self nodePath]];
    task.arguments = args;
    task.currentDirectoryURL = [NSURL fileURLWithPath:self.supportDir];
    task.standardOutput = log; task.standardError = log;
    __weak typeof(self) weak = self;
    task.terminationHandler = ^(NSTask *t) {
        [log closeFile];
        int code = t.terminationStatus;
        dispatch_async(dispatch_get_main_queue(), ^{ [weak engineFinished:code]; });
    };
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) { [log closeFile]; return [NSString stringWithFormat:@"Le moteur n’a pas démarré : %@", error.localizedDescription]; }
    self.engine = task;
    [self startProgressPolling];
    return nil;
}
- (void)runDataOnlyThen:(void (^)(void))done {
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:[self nodePath]];
    task.arguments = @[[self resource:@"sync.mjs"], @"--config", self.configPath, @"--data-only"];
    task.currentDirectoryURL = [NSURL fileURLWithPath:self.supportDir];
    task.standardOutput = NSFileHandle.fileHandleWithNullDevice; task.standardError = NSFileHandle.fileHandleWithNullDevice;
    task.terminationHandler = ^(NSTask *t) { dispatch_async(dispatch_get_main_queue(), ^{ if (done) done(); }); };
    [task launchAndReturnError:nil];
}
- (void)startProgressPolling {
    if (self.progressTimer) return;
    self.lastProgress = nil;
    self.progressTimer = [NSTimer scheduledTimerWithTimeInterval:0.6 target:self selector:@selector(pollProgress) userInfo:nil repeats:YES];
    [self pollProgress];
}
- (void)pollProgress {
    NSString *raw = [NSString stringWithContentsOfFile:[self supportFile:@"progress.json"] encoding:NSUTF8StringEncoding error:nil];
    if (raw && ![raw isEqualToString:self.lastProgress]) {
        self.lastProgress = raw;
        NSDictionary *p = [self readJSON:[self supportFile:@"progress.json"]];
        if (p) [self send:@{@"type": @"progress", @"progress": p}];
    }
    if (!self.engine.isRunning && ![self engineRunningElsewhere]) {
        [self.progressTimer invalidate]; self.progressTimer = nil;
        if (!self.engine) [self engineFinished:0];
    }
}
- (void)engineFinished:(int)code {
    self.engine = nil;
    [self.progressTimer invalidate]; self.progressTimer = nil;
    NSDictionary *lastRun = [self readJSON:[self supportFile:@"last-run.json"]] ?: @{};
    NSMutableDictionary *m = [NSMutableDictionary dictionaryWithDictionary:@{@"type": @"syncDone", @"code": @(code), @"result": lastRun, @"log": [self logText]}];
    NSDictionary *d = [self data]; if (d) m[@"data"] = d;
    [self send:m];
    [self refreshStatusItem];
    [self postNotificationsFrom:lastRun wait:NO];
    [self scheduleRemindersWait:NO];
}

#pragma mark Notifications

- (void)requestNotificationsThen:(void (^)(NSString *))done {
    [UNUserNotificationCenter.currentNotificationCenter requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge) completionHandler:^(BOOL granted, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{ if (done) done(granted ? @"authorized" : @"denied"); });
    }];
}
- (BOOL)authorizedWait {
    __block BOOL ok = NO;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [UNUserNotificationCenter.currentNotificationCenter getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *s) {
        ok = s.authorizationStatus == UNAuthorizationStatusAuthorized || s.authorizationStatus == UNAuthorizationStatusProvisional;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    return ok;
}
- (void)osascriptNotify:(NSString *)title body:(NSString *)body {
    NSString *(^q)(NSString *) = ^NSString *(NSString *s) { return [[s ?: @"" stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"] stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""]; };
    NSTask *t = [NSTask new]; t.executableURL = [NSURL fileURLWithPath:@"/usr/bin/osascript"];
    t.arguments = @[@"-e", [NSString stringWithFormat:@"display notification \"%@\" with title \"Cours Albert\" subtitle \"%@\"", q(body), q(title)]];
    [t launchAndReturnError:nil]; [t waitUntilExit];
}
- (void)postNotificationsFrom:(NSDictionary *)lastRun wait:(BOOL)wait {
    NSArray *list = [lastRun[@"notifications"] isKindOfClass:NSArray.class] ? lastRun[@"notifications"] : @[];
    if (!list.count) return;
    NSString *stamp = lastRun[@"finished"] ?: @"";
    NSString *marker = [self supportFile:@"notified.txt"];
    NSString *already = [NSString stringWithContentsOfFile:marker encoding:NSUTF8StringEncoding error:nil];
    if ([already isEqualToString:stamp]) return;
    [stamp writeToFile:marker atomically:YES encoding:NSUTF8StringEncoding error:nil];
    BOOL authorized = [self authorizedWait];
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    NSInteger i = 0;
    for (NSDictionary *n in list) {
        if (![n isKindOfClass:NSDictionary.class]) continue;
        if (!authorized) { [self osascriptNotify:n[@"title"] body:n[@"body"]]; continue; }
        UNMutableNotificationContent *c = [UNMutableNotificationContent new];
        c.title = n[@"title"] ?: @"Cours Albert"; c.body = n[@"body"] ?: @""; c.sound = UNNotificationSound.defaultSound;
        c.userInfo = @{@"route": n[@"route"] ?: @"today"};
        UNNotificationRequest *r = [UNNotificationRequest requestWithIdentifier:[NSString stringWithFormat:@"ca-info-%@-%ld", stamp, (long)i++] content:c trigger:nil];
        [UNUserNotificationCenter.currentNotificationCenter addNotificationRequest:r withCompletionHandler:^(NSError *e) { dispatch_semaphore_signal(sem); }];
        if (wait) dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
    }
}
- (NSDate *)dateFromISO:(NSString *)iso {
    if (![iso isKindOfClass:NSString.class]) return nil;
    static NSISO8601DateFormatter *withMs, *plain;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        withMs = [NSISO8601DateFormatter new]; withMs.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
        plain = [NSISO8601DateFormatter new]; plain.formatOptions = NSISO8601DateFormatWithInternetDateTime;
    });
    return [withMs dateFromString:iso] ?: [plain dateFromString:iso];
}
- (NSString *)format:(NSDate *)date pattern:(NSString *)pattern {
    NSDateFormatter *f = [NSDateFormatter new];
    f.locale = [NSLocale localeWithLocaleIdentifier:@"fr_FR"]; f.timeZone = [NSTimeZone timeZoneWithName:@"Europe/Paris"];
    f.dateFormat = pattern; return [f stringFromDate:date];
}
- (void)scheduleRemindersWait:(BOOL)wait {
    NSDictionary *data = [self data]; NSDictionary *s = [self settings];
    if (!data || ![self authorizedWait]) return;
    NSInteger minutes = [s[@"notifications"][@"classReminder"] integerValue];
    BOOL exams = [s[@"notifications"][@"examReminder"] boolValue];
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [center getPendingNotificationRequestsWithCompletionHandler:^(NSArray<UNNotificationRequest *> *requests) {
        NSMutableArray *ids = [NSMutableArray array];
        for (UNNotificationRequest *r in requests) if ([r.identifier hasPrefix:kReminderPrefix]) [ids addObject:r.identifier];
        [center removePendingNotificationRequestsWithIdentifiers:ids];
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    NSDate *now = NSDate.date; NSDate *limit = [now dateByAddingTimeInterval:7 * 86400];
    NSMutableArray *reqs = [NSMutableArray array];
    NSCalendar *cal = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian]; cal.timeZone = [NSTimeZone timeZoneWithName:@"Europe/Paris"];
    void (^add)(NSDate *, NSString *, NSString *, NSString *, NSString *) = ^(NSDate *fire, NSString *key, NSString *title, NSString *body, NSString *route) {
        if ([fire compare:now] != NSOrderedDescending || reqs.count >= 56) return;
        UNMutableNotificationContent *c = [UNMutableNotificationContent new]; c.title = title; c.body = body; c.sound = UNNotificationSound.defaultSound; c.userInfo = @{@"route": route};
        NSDateComponents *dc = [cal components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay | NSCalendarUnitHour | NSCalendarUnitMinute) fromDate:fire];
        dc.timeZone = cal.timeZone;
        [reqs addObject:[UNNotificationRequest requestWithIdentifier:[kReminderPrefix stringByAppendingString:key] content:c trigger:[UNCalendarNotificationTrigger triggerWithDateMatchingComponents:dc repeats:NO]]];
    };
    if (exams) for (NSDictionary *x in data[@"exams"]) {
        NSDate *start = [self dateFromISO:x[@"start"]]; if (!start || [start compare:now] != NSOrderedDescending || [start timeIntervalSinceDate:now] > 14 * 86400) continue;
        NSString *what = [NSString stringWithFormat:@"%@ · %@", x[@"name"] ?: @"Examen", x[@"code"] ?: @""];
        NSDateComponents *eve = [cal components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay) fromDate:[start dateByAddingTimeInterval:-86400]]; eve.hour = 19; eve.minute = 0;
        NSDate *eveDate = [cal dateFromComponents:eve];
        add(eveDate, [NSString stringWithFormat:@"exam-eve-%@", x[@"id"]], [NSString stringWithFormat:@"Demain : %@", what], [NSString stringWithFormat:@"%@ à %@ · %@", x[@"courseTitle"] ?: @"", [self format:start pattern:@"HH:mm"], x[@"durationMin"] != NSNull.null && x[@"durationMin"] ? [NSString stringWithFormat:@"%@ min", x[@"durationMin"]] : @"échéance"], @"examens");
        add([start dateByAddingTimeInterval:-3600], [NSString stringWithFormat:@"exam-1h-%@", x[@"id"]], [NSString stringWithFormat:@"Dans 1 h : %@", what], [NSString stringWithFormat:@"%@ à %@", x[@"courseTitle"] ?: @"", [self format:start pattern:@"HH:mm"]], @"examens");
    }
    if (minutes > 0) for (NSDictionary *e in data[@"schedule"]) {
        if ([e[@"kind"] isEqualToString:@"exam"]) continue;
        NSDate *start = [self dateFromISO:e[@"start"]]; if (!start || [start compare:limit] == NSOrderedDescending) continue;
        NSString *room = [e[@"room"] length] ? e[@"room"] : @"salle à confirmer";
        add([start dateByAddingTimeInterval:-60 * minutes], [NSString stringWithFormat:@"class-%@", e[@"id"]], [NSString stringWithFormat:@"Dans %ld min : %@", (long)minutes, e[@"title"] ?: @"Cours"], [NSString stringWithFormat:@"%@ · %@ – %@ · %@", e[@"code"] ?: @"", [self format:start pattern:@"HH:mm"], [self format:([self dateFromISO:e[@"end"]] ?: start) pattern:@"HH:mm"], room], @"today");
    }
    for (UNNotificationRequest *r in reqs) {
        [center addNotificationRequest:r withCompletionHandler:^(NSError *e) { dispatch_semaphore_signal(sem); }];
        if (wait) dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
    }
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center didReceiveNotificationResponse:(UNNotificationResponse *)response withCompletionHandler:(void (^)(void))completionHandler {
    NSString *route = response.notification.request.content.userInfo[@"route"];
    dispatch_async(dispatch_get_main_queue(), ^{ [self navigate:route ?: @"today"]; });
    completionHandler();
}

#pragma mark Barre des menus

- (void)setupStatusItem {
    if (self.statusItem) return;
    self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    NSImage *image = [NSImage imageWithSystemSymbolName:@"graduationcap.fill" accessibilityDescription:@"Cours Albert"];
    image.template = YES;
    self.statusItem.button.image = image;
    self.statusItem.button.imagePosition = NSImageLeading;
    NSMenu *menu = [NSMenu new]; menu.delegate = self; menu.autoenablesItems = NO;
    self.statusItem.menu = menu;
    [self refreshStatusItem];
}
- (void)removeStatusItem { if (!self.statusItem) return; [NSStatusBar.systemStatusBar removeStatusItem:self.statusItem]; self.statusItem = nil; }
- (NSArray *)classes {
    NSMutableArray *out = [NSMutableArray array];
    for (NSDictionary *e in [self data][@"schedule"]) if (![e[@"kind"] isEqualToString:@"exam"]) [out addObject:e];
    return out;
}
- (void)refreshStatusItem {
    if (!self.statusItem) return;
    NSDate *now = NSDate.date; NSString *title = @"";
    NSString *today = [self format:now pattern:@"yyyy-MM-dd"];
    for (NSDictionary *e in [self classes]) {
        NSDate *s = [self dateFromISO:e[@"start"]], *f = [self dateFromISO:e[@"end"]];
        if (!s || !f) continue;
        if ([s compare:now] != NSOrderedDescending && [f compare:now] == NSOrderedDescending) { title = [NSString stringWithFormat:@" %@ → %@", e[@"code"] ?: @"", [self format:f pattern:@"HH:mm"]]; break; }
        if ([s compare:now] == NSOrderedDescending) {
            if ([[self format:s pattern:@"yyyy-MM-dd"] isEqualToString:today]) title = [NSString stringWithFormat:@" %@ · %@", [self format:s pattern:@"HH:mm"], [e[@"room"] length] ? [e[@"room"] stringByReplacingOccurrencesOfString:@" Room" withString:@""] : (e[@"code"] ?: @"")];
            break;
        }
    }
    self.statusItem.button.title = title;
}
- (NSMenuItem *)infoItem:(NSString *)text { NSMenuItem *i = [[NSMenuItem alloc] initWithTitle:text action:nil keyEquivalent:@""]; i.enabled = NO; return i; }
- (void)menuNeedsUpdate:(NSMenu *)menu {
    if (menu != self.statusItem.menu) return;
    [menu removeAllItems];
    NSDate *now = NSDate.date;
    NSDictionary *data = [self data];
    NSString *today = [self format:now pattern:@"yyyy-MM-dd"];
    NSMutableArray *todayItems = [NSMutableArray array]; NSDictionary *next = nil;
    for (NSDictionary *e in [self classes]) {
        NSDate *s = [self dateFromISO:e[@"start"]], *f = [self dateFromISO:e[@"end"]];
        if (!s || !f || [f compare:now] != NSOrderedDescending) continue;
        if ([[self format:s pattern:@"yyyy-MM-dd"] isEqualToString:today]) [todayItems addObject:e];
        else if (!next) next = e;
    }
    if (todayItems.count) {
        [menu addItem:[self infoItem:@"Aujourd’hui"]];
        for (NSDictionary *e in todayItems) {
            NSDate *s = [self dateFromISO:e[@"start"]], *f = [self dateFromISO:e[@"end"]];
            BOOL live = [s compare:now] != NSOrderedDescending;
            NSMenuItem *i = [self item:[NSString stringWithFormat:@"%@%@–%@  %@%@", live ? @"● " : @"", [self format:s pattern:@"HH:mm"], [self format:f pattern:@"HH:mm"], e[@"title"] ?: @"", [e[@"room"] length] ? [NSString stringWithFormat:@" · %@", e[@"room"]] : @""] action:@selector(menuNavigate:) key:@"" mods:0 target:self];
            i.representedObject = @"planning"; [menu addItem:i];
        }
    } else if (next) {
        NSDate *s = [self dateFromISO:next[@"start"]];
        [menu addItem:[self infoItem:@"Prochain cours"]];
        NSMenuItem *i = [self item:[NSString stringWithFormat:@"%@  %@%@", [self format:s pattern:@"EEE d MMM HH:mm"], next[@"title"] ?: @"", [next[@"room"] length] ? [NSString stringWithFormat:@" · %@", next[@"room"]] : @""] action:@selector(menuNavigate:) key:@"" mods:0 target:self];
        i.representedObject = @"planning"; [menu addItem:i];
    } else [menu addItem:[self infoItem:data ? @"Aucun cours à venir" : @"Synchronisez pour voir votre planning"]];
    for (NSDictionary *x in data[@"exams"]) {
        NSDate *s = [self dateFromISO:x[@"start"]];
        if (!s || [s compare:now] != NSOrderedDescending) continue;
        NSInteger days = [[NSCalendar.currentCalendar components:NSCalendarUnitDay fromDate:[NSCalendar.currentCalendar startOfDayForDate:now] toDate:[NSCalendar.currentCalendar startOfDayForDate:s] options:0] day];
        [menu addItem:NSMenuItem.separatorItem];
        NSMenuItem *i = [self item:[NSString stringWithFormat:@"Prochain examen : %@ · %@ — %@ (%@)", x[@"name"], x[@"code"], [self format:s pattern:@"EEE d MMM HH:mm"], days <= 0 ? @"aujourd’hui" : days == 1 ? @"demain" : [NSString stringWithFormat:@"J-%ld", (long)days]] action:@selector(menuNavigate:) key:@"" mods:0 target:self];
        i.representedObject = @"examens"; [menu addItem:i];
        break;
    }
    for (NSDictionary *u in data[@"attendance"][@"units"]) {
        if (![u[@"below"] boolValue]) continue;
        NSMenuItem *i = [self item:[NSString stringWithFormat:@"⚠︎ %@ : %.0f %% de présence (seuil 85 %%)", u[@"code"], [u[@"rate"] doubleValue] * 100] action:@selector(menuNavigate:) key:@"" mods:0 target:self];
        i.representedObject = @"absences"; [menu addItem:i];
    }
    [menu addItem:NSMenuItem.separatorItem];
    [menu addItem:[self item:@"Ouvrir Cours Albert" action:@selector(menuOpen:) key:@"" mods:0 target:self]];
    NSMenuItem *sync = [self item:(self.engine.isRunning || [self engineRunningElsewhere]) ? @"Synchronisation en cours…" : @"Synchroniser maintenant" action:@selector(menuSync:) key:@"" mods:0 target:self];
    sync.enabled = !(self.engine.isRunning || [self engineRunningElsewhere]); [menu addItem:sync];
    NSMenuItem *prefs = [self item:@"Réglages…" action:@selector(menuNavigate:) key:@"" mods:0 target:self]; prefs.representedObject = @"reglages"; [menu addItem:prefs];
    [menu addItem:NSMenuItem.separatorItem];
    [menu addItem:[self item:@"Quitter Cours Albert" action:@selector(terminate:) key:@"" mods:0 target:NSApp]];
}
- (void)menuOpen:(id)sender { [self showWindow]; }

#pragma mark Mode automatique (LaunchAgent)

- (int)runBackground {
    [self setupSupport];
    if (![self hasConfig]) return 0;
    if ([self engineRunningElsewhere]) return 0;
    NSString *logPath = [self supportFile:@"automatic.log"];
    NSDictionary *attrs = [NSFileManager.defaultManager attributesOfItemAtPath:logPath error:nil];
    if ([attrs fileSize] > 2000000) [NSFileManager.defaultManager removeItemAtPath:logPath error:nil];
    if (![NSFileManager.defaultManager fileExistsAtPath:logPath]) [NSFileManager.defaultManager createFileAtPath:logPath contents:nil attributes:nil];
    NSFileHandle *log = [NSFileHandle fileHandleForWritingAtPath:logPath]; [log seekToEndOfFile];
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:[self nodePath]];
    task.arguments = @[[self resource:@"sync.mjs"], @"--config", self.configPath];
    task.currentDirectoryURL = [NSURL fileURLWithPath:self.supportDir];
    task.standardOutput = log; task.standardError = log;
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) { [log writeData:[[NSString stringWithFormat:@"Erreur de lancement : %@\n", error.localizedDescription] dataUsingEncoding:NSUTF8StringEncoding]]; [log closeFile]; return 1; }
    [task waitUntilExit]; [log closeFile];
    [self postNotificationsFrom:[self readJSON:[self supportFile:@"last-run.json"]] wait:YES];
    [self scheduleRemindersWait:YES];
    return task.terminationStatus;
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSArray *args = NSProcessInfo.processInfo.arguments;
        if ([args containsObject:@"--background"]) return [[AppController new] runBackground];
        NSApplication *app = [NSApplication sharedApplication];
        AppController *controller = [AppController new];
        controller.menubarLaunch = [args containsObject:@"--menubar"];
        app.delegate = controller;
        [app run];
    }
    return 0;
}
