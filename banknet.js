// =====================================================
// LinkUpNetBank — アプリ本体
//  - ログイン照合: LinkUp 本体プロジェクト(linkup5)の accounts を読み取り
//  - 残高/取引:    LinkUpNetBank 専用プロジェクト(RTDB)
//  - 口座キー:     LinkUp の UID（不変）
// =====================================================

class LinkUpNetBank {
    constructor() {
        this.name = null;
        this.uid = null;
        this.account = null;        // 自分の銀行口座(live)
        this.txCache = [];          // 自分の取引(降順)
        this._pendingPay = null;    // 支払いリンク由来の保留
        this._scanner = null;
        this._receiveQr = null;
        this.settings = this._loadSettings();
        this.subsCache = [];
        this._accounts = this._loadAccounts();
        this._adding = false;

        this._cacheEls();
        this._bindStaticEvents();
        this._init();
    }

    // ---------- 暗号(LinkUp 互換) ----------
    _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + c;
            hash = hash & hash;
        }
        const salted = 'svc_' + str + '_hash';
        let hash2 = 0;
        for (let i = 0; i < salted.length; i++) {
            const c = salted.charCodeAt(i);
            hash2 = ((hash2 << 5) - hash2) + c;
            hash2 = hash2 & hash2;
        }
        return Math.abs(hash).toString(16) + Math.abs(hash2).toString(16);
    }
    _encName(name) { return encodeURIComponent(name).replace(/\./g, '%2E'); }

    // ---------- 初期化 ----------
    async _init() {
        if (!this._configReady()) {
            this._showError(this.els.loginError,
                'まだ Firebase の設定が未入力です。banknet-config.js の BANK_CONFIG を設定してください。');
            this.els.loginBtn.disabled = true;
            return;
        }
        try {
            this.bankApp = firebase.initializeApp(window.BANK_CONFIG);            // 既定: 銀行
            this.linkupApp = firebase.initializeApp(window.LINKUP_CONFIG, 'linkup'); // 照合用
            this.bankDb = this.bankApp.database();
            this.authDb = this.linkupApp.database();
            this.bankAuth = this.bankApp.auth();
        } catch (e) {
            this._showError(this.els.loginError, 'Firebase の初期化に失敗しました: ' + e.message);
            return;
        }

        // 匿名サインイン（ルールで auth!=null を要求するため）
        try {
            await this.bankAuth.signInAnonymously();
        } catch (e) {
            this._toast('認証に接続できませんでした。Authenticationの「匿名」を有効にしてください。', 'error', 6000);
        }

        // セッション復元 → 失敗ならログイン画面
        this.els.bootOverlay.hidden = false;
        let restored = false;
        try { restored = await this._restore(); } catch (_) {}
        this.els.bootOverlay.hidden = true;
        if (!restored) this._show(this.els.loginScreen);
    }

    _configReady() {
        const c = window.BANK_CONFIG || {};
        return !!(c.apiKey && c.apiKey !== 'ここに貼り付け' && c.appId && !/x{6,}/.test(c.appId));
    }

    // ---------- 要素 ----------
    _cacheEls() {
        const id = x => document.getElementById(x);
        this.els = {
            loginScreen: id('loginScreen'), appScreen: id('appScreen'), bootOverlay: id('bootOverlay'),
            loginName: id('loginName'), loginPass: id('loginPass'), loginBtn: id('loginBtn'), loginError: id('loginError'),
            loginBack: id('loginBack'), topAvatar: id('topAvatar'),
            accountModal: id('accountModal'), accountList: id('accountList'), addAccountBtn: id('addAccountBtn'),
            balanceValue: id('balanceValue'), frozenBadge: id('frozenBadge'),
            ownerName: id('ownerName'), ownerUid: id('ownerUid'),
            recentList: id('recentList'), recentEmpty: id('recentEmpty'),
            sideName: id('sideName'), sideUid: id('sideUid'), sideAvatar: id('sideAvatar'),
            // send
            sendModal: id('sendModal'), sendTo: id('sendTo'), sendToInfo: id('sendToInfo'),
            sendAmount: id('sendAmount'), sendMemo: id('sendMemo'), sendError: id('sendError'), sendConfirmBtn: id('sendConfirmBtn'),
            suggestPopup: id('userSuggestionPopup'),
            // receive
            receiveModal: id('receiveModal'), receiveQr: id('receiveQr'),
            invoiceAmount: id('invoiceAmount'), invoiceApply: id('invoiceApply'), copyPayLink: id('copyPayLink'),
            // scan
            scanModal: id('scanModal'), scanRegion: id('scanRegion'), scanStatus: id('scanStatus'),
            scanPaste: id('scanPaste'), scanPasteGo: id('scanPasteGo'),
            // history
            historyModal: id('historyModal'), historyList: id('historyList'), historyEmpty: id('historyEmpty'),
            // admin
            adminModal: id('adminModal'), mintTo: id('mintTo'), mintAmount: id('mintAmount'), mintMemo: id('mintMemo'),
            mintError: id('mintError'), mintBtn: id('mintBtn'),
            adminAccountList: id('adminAccountList'), adminAccountEmpty: id('adminAccountEmpty'),
            adminEditModal: id('adminEditModal'), editName: id('editName'), editCurrent: id('editCurrent'),
            editBalance: id('editBalance'), editError: id('editError'), editSaveBtn: id('editSaveBtn'),
            // subscriptions（確認・停止のみ）
            subsModal: id('subsModal'),
            subPayingList: id('subPayingList'), subPayingEmpty: id('subPayingEmpty'),
            subReceivingWrap: id('subReceivingWrap'), subReceivingList: id('subReceivingList'),
            // settings
            settingsModal: id('settingsModal'), setAutoLogin: id('setAutoLogin'), setConfirmSend: id('setConfirmSend'),
            setAvatar: id('setAvatar'), setName: id('setName'), setUid: id('setUid'),
            // confirm / toast
            confirmModal: id('confirmModal'), confirmText: id('confirmText'), confirmOk: id('confirmOk'), confirmCancel: id('confirmCancel'),
            toastStack: id('toastStack'),
            // ===== ギャンブル =====
            gambleModal: id('gambleModal'), gambleHouseInfo: id('gambleHouseInfo'),
            // QUICKONE
            quickoneModal: id('quickoneModal'), quickoneCost: id('quickoneCost'), quickoneBet: id('quickoneBet'),
            quickoneTable: id('quickoneTable'), quickoneResult: id('quickoneResult'), quickonePlay: id('quickonePlay'),
            quickonePrizeNote: id('quickonePrizeNote'),
            // ジャンボ（利用者）
            jumboModal: id('jumboModal'), jumboList: id('jumboList'), jumboEmpty: id('jumboEmpty'),
            jumboTicketsModal: id('jumboTicketsModal'), myTicketsTitle: id('myTicketsTitle'),
            myTicketsSummary: id('myTicketsSummary'), myTicketsBody: id('myTicketsBody'),
            // ジャンボ管理: 一覧 / 残高
            openJumboCreate: id('openJumboCreate'),
            adminJumboList: id('adminJumboList'), adminJumboEmpty: id('adminJumboEmpty'),
            adminHouseBal: id('adminHouseBal'), adminCentralBal: id('adminCentralBal'),
            adminHouseFund: id('adminHouseFund'), adminCentralFund: id('adminCentralFund'),
            // ジャンボ作成
            jumboCreateModal: id('jumboCreateModal'),
            jcName: id('jcName'), jcDigits: id('jcDigits'), jcPrice: id('jcPrice'),
            jcPrize1: id('jcPrize1'), jcPrize2: id('jcPrize2'), jcPrize3: id('jcPrize3'),
            jcPrize4: id('jcPrize4'), jcPrize5: id('jcPrize5'),
            jcPrize6: id('jcPrize6'), jcPrize7: id('jcPrize7'), jcPrize8: id('jcPrize8'),
            jcError: id('jcError'), jcCreate: id('jcCreate'),
            // ジャンボ抽選
            jumboDrawModal: id('jumboDrawModal'), jdTitle: id('jdTitle'), jdHint: id('jdHint'),
            jdWin1: id('jdWin1'), jdWin2: id('jdWin2'), jdWin3: id('jdWin3'),
            jdWin4: id('jdWin4'), jdWin5: id('jdWin5'),
            jdWin6: id('jdWin6'), jdWin7: id('jdWin7'), jdWin8: id('jdWin8'),
            jdError: id('jdError'), jdConfirm: id('jdConfirm'),
            // ジャンボ 金額変更
            jumboEditModal: id('jumboEditModal'), jeTitle: id('jeTitle'), jePrice: id('jePrice'),
            jePrize1: id('jePrize1'), jePrize2: id('jePrize2'), jePrize3: id('jePrize3'),
            jePrize4: id('jePrize4'), jePrize5: id('jePrize5'),
            jePrize6: id('jePrize6'), jePrize7: id('jePrize7'), jePrize8: id('jePrize8'),
            jeError: id('jeError'), jeSave: id('jeSave'),
            // 長者番付
            richModal: id('richModal'), richList: id('richList'), richEmpty: id('richEmpty'),
            adminRichList: id('adminRichList'), adminRichEmpty: id('adminRichEmpty'),
        };
    }

    _bindStaticEvents() {
        this.els.loginBtn.addEventListener('click', () => this._onLogin());
        this.els.loginName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.els.loginPass.focus(); } });
        this.els.loginPass.addEventListener('keydown', e => { if (e.key === 'Enter') this._onLogin(); });
        this.els.loginBack.addEventListener('click', () => this._cancelAdd());
        this.els.addAccountBtn.addEventListener('click', () => this._addAccountFlow());
        document.querySelectorAll('.js-logout').forEach(b => b.addEventListener('click', () => this._logout()));

        // クイック操作（メイン + 「すべて見る」）
        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => this._action(btn.dataset.action));
        });

        // モーダルを閉じる
        document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this._closeModals()));
        document.querySelectorAll('[data-close-edit]').forEach(b => b.addEventListener('click', () => this._closeEditModal()));
        document.querySelectorAll('.modal').forEach(m => {
            m.addEventListener('click', e => {
                if (e.target !== m) return;
                if (m.id === 'adminEditModal') this._closeEditModal();
                else this._closeModals();
            });
        });

        // 送金
        this.els.sendConfirmBtn.addEventListener('click', () => this._onSend());
        this.els.sendTo.addEventListener('change', () => this._previewRecipient());

        // ユーザー名の予測候補（LinkUp 流のカスタムポップアップ）
        document.querySelectorAll('input[data-suggest-users="true"]').forEach(inp => this._bindSuggestInput(inp));

        // 受け取る
        this.els.invoiceApply.addEventListener('click', () => this._renderReceiveQr(this._intOrNull(this.els.invoiceAmount.value)));
        this.els.copyPayLink.addEventListener('click', () => this._copyPayLink());

        // スキャン
        this.els.scanPasteGo.addEventListener('click', () => {
            this._handlePayUrl(this.els.scanPaste.value.trim());
        });

        // 管理
        this.els.mintBtn.addEventListener('click', () => this._onMint());
        this.els.editSaveBtn.addEventListener('click', () => this._onSaveBalance());

        // 設定
        this.els.setAutoLogin.addEventListener('change', () => {
            this.settings.autoLogin = this.els.setAutoLogin.checked; this._saveSettings();
        });
        this.els.setConfirmSend.addEventListener('change', () => {
            this.settings.confirmSend = this.els.setConfirmSend.checked; this._saveSettings();
        });

        // ギャンブル
        this._bindGambleEvents();
    }

    _bindGambleEvents() {
        if (this.els.quickonePlay) this.els.quickonePlay.addEventListener('click', () => this._playQuickone());
        if (this.els.quickoneBet) {
            this.els.quickoneBet.addEventListener('input', () => this._updateQuickoneCost());
            this.els.quickoneBet.addEventListener('blur', () => { this.els.quickoneBet.value = this._quickoneBet(); this._updateQuickoneCost(); });
        }
        document.querySelectorAll('.qo-chip').forEach(c => c.addEventListener('click', () => {
            if (this.els.quickoneBet) { this.els.quickoneBet.value = c.dataset.bet; this._updateQuickoneCost(); }
        }));
        if (this.els.openJumboCreate) this.els.openJumboCreate.addEventListener('click', () => this._openJumboCreate());
        if (this.els.jcCreate) this.els.jcCreate.addEventListener('click', () => this._createJumboDraw());
        if (this.els.jdConfirm) this.els.jdConfirm.addEventListener('click', () => this._finalizeJumboDraw());
        if (this.els.jeSave) this.els.jeSave.addEventListener('click', () => this._saveJumboEdit());
        if (this.els.adminHouseFund) this.els.adminHouseFund.addEventListener('click', async () => {
            const h = await this._houseAccount();
            if (h && (this._adminAccounts || []).some(a => a.uid === h.uid)) this._openEditBalance(h.uid);
            else this._toast('口座一覧の「残高」、または発行(mint)で資金を追加してください', 'info', 4500);
        });
        if (this.els.adminCentralFund) this.els.adminCentralFund.addEventListener('click', async () => {
            const c = await this._centralAccount();
            if (c && (this._adminAccounts || []).some(a => a.uid === c.uid)) this._openEditBalance(c.uid);
            else this._toast('口座一覧の「残高」、または発行(mint)で資金を追加してください', 'info', 4500);
        });
    }

    _action(a) {
        if (a === 'home') { this._closeModals(); this._setActiveNav('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        else if (a === 'send') this._openSend();
        else if (a === 'receive') this._openReceive();
        else if (a === 'scan') this._openScan();
        else if (a === 'history') { this._setActiveNav('history'); this._openHistory(); }
        else if (a === 'admin') { this._setActiveNav('admin'); this._openAdmin(); }
        else if (a === 'subs') { this._setActiveNav('subs'); this._openSubs(); }
        else if (a === 'gamble') { this._setActiveNav('gamble'); this._openGamble(); }
        else if (a === 'rich') { this._setActiveNav('rich'); this._openRich(); }
        else if (a === 'quickone') this._openQuickone();
        else if (a === 'jumbo') this._openJumbo();
        else if (a === 'keiba') this._toast('競馬は準備中です（近日公開）', 'info', 3500);
        else if (a === 'settings') { this._setActiveNav('settings'); this._openSettings(); }
        else if (a === 'accounts') this._openAccounts();
    }

    _setActiveNav(action) {
        document.querySelectorAll('.snav__item, .tabbar__item').forEach(el => {
            el.classList.toggle('is-active', el.dataset.action === action);
        });
    }

    // =====================================================
    // 認証 / セッション
    // =====================================================
    async _getLinkupAccount(name) {
        const snap = await this.authDb.ref('accounts/' + this._encName(name)).get();
        if (!snap.exists()) return null;
        const v = snap.val();
        return { name: v.name || name, passwordHash: v.passwordHash, uid: v.uid || null, frozen: !!v.frozen };
    }

    async _onLogin() {
        const name = this.els.loginName.value.trim();
        const pass = this.els.loginPass.value;
        this._hide(this.els.loginError);
        if (!name || !pass) return this._showError(this.els.loginError, '名前とパスワードを入力してください。');
        this.els.loginBtn.disabled = true;
        try {
            const acc = await this._getLinkupAccount(name);
            if (!acc || acc.passwordHash !== this._simpleHash(pass)) {
                throw new Error('名前またはパスワードが違います。');
            }
            if (!acc.uid) {
                throw new Error('この名前にはまだ UID がありません。一度 LinkUp 本体にログインすると発行されます。');
            }
            this.name = acc.name;
            this.uid = acc.uid;
            await this._ensureBankAccount(this.uid, this.name);
            this._saveSession();
            this.els.loginPass.value = '';
            this._enterApp();
        } catch (e) {
            this._showError(this.els.loginError, e.message || 'ログインに失敗しました。');
        } finally {
            this.els.loginBtn.disabled = false;
        }
    }

    _saveSession() {
        localStorage.setItem('lunb_session', JSON.stringify({ name: this.name, uid: this.uid }));
        localStorage.setItem('lunb_active', this.uid);
        this._upsertAccount(this.name, this.uid);
    }

    async _restore() {
        if (!this.settings.autoLogin) return false;   // 自動ログインOFF → 毎回ログイン画面
        const raw = localStorage.getItem('lunb_session');
        if (!raw) return false;
        let s; try { s = JSON.parse(raw); } catch { return false; }
        if (!s || !s.uid) return false;

        // UID を軸に、現在の表示名を解決（LinkUp で改名済みでも追従）
        let name = s.name;
        try {
            const acc = s.name ? await this._getLinkupAccount(s.name) : null;
            if (acc && acc.uid === s.uid) {
                name = acc.name;
            } else {
                const usnap = await this.authDb.ref('uids/' + s.uid).get();
                if (usnap.exists() && usnap.val().name) name = usnap.val().name;
                else if (!acc) { /* 名前も UID も解決不能なら保留してそのまま */ }
                else return false; // 別人に名前が渡っている等
            }
        } catch (_) { /* オフライン等。保存値で続行 */ }

        this.name = name;
        this.uid = s.uid;
        if (this.name !== s.name) this._saveSession();
        await this._ensureBankAccount(this.uid, this.name);
        this._enterApp();
        return true;
    }

    _detachUserWatchers() {
        if (this.uid) {
            this.bankDb.ref('accounts/' + this.uid).off();
            this.bankDb.ref('userLedger/' + this.uid).off();
        }
    }

    _logout() {
        if (this._subTimer) clearInterval(this._subTimer);
        this._detachUserWatchers();
        // 現在のアカウントを保存リストから外す
        const list = this._loadAccounts().filter(a => a.uid !== this.uid);
        localStorage.setItem('lunb_accounts', JSON.stringify(list));
        if (list.length > 0) {
            localStorage.setItem('lunb_active', list[0].uid);
            localStorage.setItem('lunb_session', JSON.stringify(list[0]));
        } else {
            localStorage.removeItem('lunb_active');
            localStorage.removeItem('lunb_session');
        }
        location.reload();
    }

    // ----- 複数アカウント -----
    _loadAccounts() {
        try {
            const l = JSON.parse(localStorage.getItem('lunb_accounts') || '[]');
            this._accounts = Array.isArray(l) ? l.filter(a => a && a.uid) : [];
        } catch { this._accounts = []; }
        return this._accounts;
    }
    _upsertAccount(name, uid) {
        const list = this._loadAccounts();
        const i = list.findIndex(a => a.uid === uid);
        if (i >= 0) list[i] = { name, uid }; else list.push({ name, uid });
        this._accounts = list;
        localStorage.setItem('lunb_accounts', JSON.stringify(list));
    }

    _openAccounts() {
        const list = this._loadAccounts();
        this.els.accountList.innerHTML = list.map(a => {
            const active = a.uid === this.uid;
            const letter = this._esc((a.name || '?').slice(0, 1).toUpperCase());
            const right = active
                ? '<i class="fa-solid fa-circle-check acctsw__check"></i>'
                : `<button class="acctsw__remove" data-remove="${this._esc(a.uid)}" title="削除"><i class="fa-solid fa-xmark"></i></button>`;
            return `<li class="acctsw ${active ? 'is-active' : ''}" data-switch="${this._esc(a.uid)}">
                <span class="avatar">${letter}</span>
                <div class="acctsw__meta">
                    <span class="acctsw__name">${this._esc(a.name)}</span>
                    <span class="acctsw__uid">#${this._esc(a.uid)}</span>
                </div>
                ${right}
            </li>`;
        }).join('');
        this.els.accountList.querySelectorAll('.acctsw__remove').forEach(b => {
            b.addEventListener('click', e => { e.stopPropagation(); this._removeAccount(b.dataset.remove); });
        });
        this.els.accountList.querySelectorAll('[data-switch]').forEach(li => {
            li.addEventListener('click', () => this._switchAccount(li.dataset.switch));
        });
        this._show(this.els.accountModal);
    }

    _removeAccount(uid) {
        const list = this._loadAccounts().filter(a => a.uid !== uid);
        this._accounts = list;
        localStorage.setItem('lunb_accounts', JSON.stringify(list));
        this._openAccounts(); // 再描画
    }

    async _switchAccount(uid) {
        if (uid === this.uid) { this._closeModals(); return; }
        const acc = (this._loadAccounts()).find(a => a.uid === uid);
        if (!acc) return;
        let name = acc.name;
        try { const r = await this._resolveByUid(uid); if (r && r.name) name = r.name; } catch (_) {}

        this._detachUserWatchers();
        if (this._subTimer) clearInterval(this._subTimer);
        this.name = name;
        this.uid = uid;
        this._upsertAccount(name, uid);
        localStorage.setItem('lunb_active', uid);
        localStorage.setItem('lunb_session', JSON.stringify({ name, uid }));
        try { await this._ensureBankAccount(uid, name); } catch (_) {}
        this._closeModals();
        this._enterApp();
        this._toast(`${name} に切り替えました`, 'success');
    }

    // 別アカウントを追加（現在のアカウントは保持したままログイン画面へ）
    _addAccountFlow() {
        this._closeModals();
        this._adding = true;
        this._detachUserWatchers();
        if (this._subTimer) clearInterval(this._subTimer);
        this.els.loginName.value = '';
        this.els.loginPass.value = '';
        this._hide(this.els.loginError);
        this.els.appScreen.hidden = true;
        this.els.loginBack.hidden = false;
        this._show(this.els.loginScreen);
        setTimeout(() => this.els.loginName.focus(), 50);
    }

    // 追加をやめて元のアカウントに戻る
    _cancelAdd() {
        this._adding = false;
        this.els.loginBack.hidden = true;
        this.els.loginScreen.hidden = true;
        if (this.uid) this._enterApp();
    }

    // =====================================================
    // 口座
    // =====================================================
    async _ensureBankAccount(uid, name) {
        const ref = this.bankDb.ref('accounts/' + uid);
        const snap = await ref.get();
        if (!snap.exists()) {
            await ref.set({ uid, name, balance: 0, frozen: false, createdAt: Date.now() });
        } else if (snap.val().name !== name) {
            await ref.child('name').set(name);  // 改名追従
        }
    }

    _enterApp() {
        this._adding = false;
        if (this.els.loginBack) this.els.loginBack.hidden = true;
        this._show(this.els.appScreen);
        this.els.loginScreen.hidden = true;
        this.els.ownerName.textContent = this.name + ' 様';
        this.els.ownerUid.textContent = '#' + this.uid;
        if (this.els.sideName) this.els.sideName.textContent = this.name;
        if (this.els.sideUid) this.els.sideUid.textContent = '#' + this.uid;
        const letter = (this.name || '?').slice(0, 1).toUpperCase();
        if (this.els.sideAvatar) this.els.sideAvatar.textContent = letter;
        if (this.els.topAvatar) this.els.topAvatar.textContent = letter;

        // 管理者ゲート（毎回リセットしてから判定：別アカウントへ切り替えても整合）
        const isAdmin = this.name === (window.BANK_ADMIN_NAME || '管理者');
        document.querySelectorAll('.js-admin-only').forEach(el => { el.hidden = !isAdmin; });

        this._watchAccount();
        this._watchLedger();
        this._loadAccountNames();

        // 支払いリンク
        this._consumePayParams();

        // 期日が来ているサブスクを処理（サーバーなし構成のため「開いている人」が課金エンジンになる）
        this._processDueSubscriptions();
        if (this._subTimer) clearInterval(this._subTimer);
        this._subTimer = setInterval(() => this._processDueSubscriptions(), 120000); // 開いている間も2分ごとに巡回
    }

    _watchAccount() {
        this.bankDb.ref('accounts/' + this.uid).on('value', snap => {
            this.account = snap.val() || { balance: 0, frozen: false };
            this.els.balanceValue.textContent = this._fmt(Math.floor(this.account.balance || 0));
            this.els.frozenBadge.hidden = !this.account.frozen;
        });
    }

    _watchLedger() {
        this.bankDb.ref('userLedger/' + this.uid).on('value', snap => {
            const obj = snap.val() || {};
            // ジャンボ宝くじ関連は取引画面に表示しない（記録は残す）
            this.txCache = Object.values(obj).filter(t => t && t.type !== 'jumbo').sort((a, b) => b.ts - a.ts);
            this._renderRecent();
            if (!this.els.historyModal.hidden) this._renderHistory();
        });
    }

    async _loadAccountNames() {
        // 送金/発行の予測候補用に LinkUp の全アカウント名を取得してキャッシュ
        try {
            const snap = await this.authDb.ref('accounts').get();
            const names = [];
            snap.forEach(ch => { const v = ch.val(); if (v && v.name) names.push(v.name); });
            this._allAccountNames = names;
        } catch (_) { this._allAccountNames = this._allAccountNames || []; }
    }

    // ===== ユーザー名の予測候補（LinkUp 流カスタムポップアップ） =====
    _toHiragana(s) {
        return String(s || '').replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
    }
    _normalizeForMatch(s) {
        return this._toHiragana(String(s || '').toLowerCase().normalize('NFKC'));
    }
    // これまで取引した相手・サブスク提供者を「取引あり」として優先表示
    _familiarNames() {
        const set = new Set();
        for (const t of (this.txCache || [])) {
            if (t.fromName && t.fromName !== this.name) set.add(t.fromName);
            if (t.toName && t.toName !== this.name) set.add(t.toName);
        }
        for (const s of (this.subsCache || [])) {
            if (s.payerUid === this.uid && s.payeeName) set.add(s.payeeName);
        }
        return set;
    }

    _bindSuggestInput(inp) {
        if (!inp || inp._suggestBound) return;
        inp._suggestBound = true;
        inp.addEventListener('focus', () => { this._loadAccountNames().then(() => this._showSuggest(inp)); });
        inp.addEventListener('input', () => this._showSuggest(inp));
        inp.addEventListener('blur', () => setTimeout(() => this._hideSuggest(), 150));
    }

    _showSuggest(inputEl) {
        const popup = this.els.suggestPopup;
        if (!popup || !inputEl) return;
        const nq = this._normalizeForMatch(inputEl.value || '');
        const all = (this._allAccountNames || []).filter(n => n && n !== this.name);
        const familiar = this._familiarNames();

        let filtered = nq === ''
            ? all.slice()
            : all.filter(n => this._normalizeForMatch(n).includes(nq));

        filtered.sort((a, b) => {
            const na = this._normalizeForMatch(a), nb = this._normalizeForMatch(b);
            const ra = na === nq ? 0 : (na.startsWith(nq) ? 1 : 2);
            const rb = nb === nq ? 0 : (nb.startsWith(nq) ? 1 : 2);
            if (nq && ra !== rb) return ra - rb;
            const fa = familiar.has(a) ? 0 : 1, fb = familiar.has(b) ? 0 : 1;
            if (fa !== fb) return fa - fb;
            return a.localeCompare(b, 'ja');
        });
        filtered = filtered.slice(0, 8);

        if (filtered.length === 0) {
            popup.innerHTML = `<div class="suggest-empty">候補がありません</div>`;
        } else {
            popup.innerHTML = filtered.map(n => {
                const letter = this._esc((n.charAt(0) || '?').toUpperCase());
                const tag = familiar.has(n) ? '<span class="suggest-tag">取引あり</span>' : '';
                let display;
                if (nq) {
                    const idx = this._normalizeForMatch(n).indexOf(nq);
                    if (idx >= 0) {
                        display = this._esc(n.slice(0, idx)) + '<mark>' + this._esc(n.slice(idx, idx + nq.length)) + '</mark>' + this._esc(n.slice(idx + nq.length));
                    } else display = this._esc(n);
                } else display = this._esc(n);
                return `<div class="suggest-item" data-name="${this._esc(n)}">
                    <span class="suggest-avatar">${letter}</span>
                    <span class="suggest-name">${display}</span>${tag}
                </div>`;
            }).join('');
            popup.querySelectorAll('.suggest-item').forEach(item => {
                item.addEventListener('mousedown', e => {
                    e.preventDefault();
                    inputEl.value = item.dataset.name;
                    this._hideSuggest();
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                });
            });
        }

        const rect = inputEl.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const width = Math.min(Math.max(rect.width, 220), vw - 16);
        let left = rect.left;
        if (left + width > vw - 8) left = vw - 8 - width;
        if (left < 8) left = 8;
        popup.style.display = '';
        popup.style.left = left + 'px';
        popup.style.top = (rect.bottom + 4) + 'px';
        popup.style.width = width + 'px';
        popup.style.maxHeight = Math.max(140, vh - rect.bottom - 12) + 'px';
    }

    _hideSuggest() {
        if (this.els.suggestPopup) this.els.suggestPopup.style.display = 'none';
    }

    // =====================================================
    // 送金
    // =====================================================
    _openSend(prefill) {
        this._hide(this.els.sendError);
        this.els.sendToInfo.textContent = '';
        this.els.sendToInfo.className = 'field-hint';
        this.els.sendTo.value = prefill?.name || '';
        this.els.sendAmount.value = prefill?.amount || '';
        this.els.sendMemo.value = prefill?.memo || '';
        this._show(this.els.sendModal);
        if (!prefill?.name) setTimeout(() => this.els.sendTo.focus(), 50);
    }

    async _previewRecipient() {
        const name = this.els.sendTo.value.trim();
        if (!name) { this.els.sendToInfo.textContent = ''; return; }
        const r = await this._resolveByName(name);
        if (!r) {
            this.els.sendToInfo.textContent = '見つかりません';
            this.els.sendToInfo.className = 'field-hint is-bad';
        } else if (!r.uid) {
            this.els.sendToInfo.textContent = '相手がまだ LinkUp 最新版で未ログインのため送れません';
            this.els.sendToInfo.className = 'field-hint is-bad';
        } else {
            this.els.sendToInfo.textContent = '→ ' + r.name + '（#' + r.uid + '）';
            this.els.sendToInfo.className = 'field-hint is-ok';
        }
    }

    async _onSend() {
        this._hide(this.els.sendError);
        const name = this.els.sendTo.value.trim();
        const amount = this._intOrNull(this.els.sendAmount.value);
        const memo = this.els.sendMemo.value.trim();
        if (!name) return this._showError(this.els.sendError, '送り先を入力してください。');
        if (!amount || amount < 1) return this._showError(this.els.sendError, '1 以上の金額を入力してください。');

        this.els.sendConfirmBtn.disabled = true;
        try {
            const r = (this._pendingPay && this._pendingPay.name === name)
                ? this._pendingPay
                : await this._resolveByName(name);
            if (!r) throw new Error('「' + name + '」が見つかりません。');
            if (!r.uid) throw new Error('相手がまだ LinkUp 最新版でログインしていないため送れません。');
            if (r.uid === this.uid) throw new Error('自分には送金できません。');

            const ok = !this.settings.confirmSend
                || await this._confirm(`${r.name} さんに ${this._fmt(amount)} W を送りますか？`);
            if (!ok) return;

            await this._doTransfer(r.uid, r.name, amount, memo);
            this._pendingPay = null;
            this._closeModals();
            this._toast(`${r.name} さんに ${this._fmt(amount)} W を送りました`, 'success');
        } catch (e) {
            this._showError(this.els.sendError, e.message || '送金できませんでした。');
        } finally {
            this.els.sendConfirmBtn.disabled = false;
        }
    }

    async _doTransfer(toUid, toName, amount, memo) {
        // 事前チェック（具体的なエラー文言のため）
        if (!this.account || this.account.frozen) throw new Error('あなたの口座は凍結されています。');
        if ((this.account.balance || 0) < amount) throw new Error('残高が足りません。');
        await this._ensureBankAccount(toUid, toName);
        const rsnap = await this.bankDb.ref('accounts/' + toUid).get();
        if (rsnap.exists() && rsnap.val().frozen) throw new Error('相手の口座は凍結されています。');

        const moved = await this._moveFunds(this.uid, toUid, amount, toName);
        if (!moved) throw new Error('一時的に処理が競合しました。もう一度お試しください。');

        await this._writeLedger({
            type: 'transfer', amount, fromUid: this.uid, fromName: this.name, toUid, toName, memo, ts: Date.now()
        }, this.uid, toUid);
    }

    // 対象 ref が同期されるまで待つ（最大5秒）。未キャッシュによる transaction の null 初回中止を防ぐ。
    _waitValue(ref) {
        return new Promise(res => {
            let done = false;
            const t = setTimeout(() => { if (!done) { done = true; res(); } }, 5000);
            ref.once('value', () => { if (!done) { done = true; clearTimeout(t); res(); } });
        });
    }

    // 残高を移動（マイナス・凍結を禁止）。成功=true。失敗理由は例外で返す。
    async _moveFunds(fromUid, toUid, amount, toName) {
        const fromRef = this.bankDb.ref('accounts/' + fromUid);
        const toRef = this.bankDb.ref('accounts/' + toUid);
        // 一時リスナーで両口座を同期ツリーに載せる（自分以外の口座でも null 初回中止を防ぐ）
        const fcb = fromRef.on('value', () => {});
        const tcb = toRef.on('value', () => {});
        try {
            await this._waitValue(fromRef);
            await this._waitValue(toRef);

            // 1) 送金元から引く
            let reason = null, debit;
            try {
                debit = await fromRef.transaction(acc => {
                    if (!acc) { reason = 'no_account'; return; }
                    if (acc.frozen) { reason = 'frozen_from'; return; }
                    if (typeof acc.balance !== 'number' || acc.balance < amount) { reason = 'insufficient'; return; }
                    acc.balance = acc.balance - amount;
                    return acc;
                });
            } catch (e) {
                throw new Error('権限エラーで送金できませんでした。Authentication の「匿名」が有効か確認してください。');
            }
            if (!debit.committed) {
                if (reason === 'frozen_from') throw new Error('あなたの口座は凍結されています。');
                if (reason === 'insufficient') throw new Error('残高が足りません。');
                if (reason === 'no_account') throw new Error('あなたの口座が見つかりませんでした。');
                return false; // 競合
            }

            // 2) 送金先へ足す（null＝未キャッシュ/未作成でも初期化して作成）
            let credit;
            try {
                credit = await toRef.transaction(acc => {
                    if (acc) {
                        if (acc.frozen) return; // 相手凍結 → 中止して返金
                        acc.balance = (acc.balance || 0) + amount;
                        return acc;
                    }
                    return { uid: toUid, name: toName || toUid, balance: amount, frozen: false, createdAt: Date.now() };
                });
            } catch (e) {
                credit = { committed: false };
            }
            if (!credit.committed) {
                // 返金（送金元へ戻す）
                try { await fromRef.child('balance').transaction(b => (typeof b === 'number' ? b + amount : amount)); } catch (_) {}
                throw new Error('相手の口座へ反映できませんでした。取り消しました。');
            }
            return true;
        } finally {
            fromRef.off('value', fcb);
            toRef.off('value', tcb);
        }
    }

    async _writeLedger(entry, fromUid, toUid) {
        const txId = this.bankDb.ref('ledger').push().key;
        const updates = {};
        updates['ledger/' + txId] = entry;
        if (fromUid) updates['userLedger/' + fromUid + '/' + txId] = { ...entry, dir: 'out' };
        if (toUid) updates['userLedger/' + toUid + '/' + txId] = { ...entry, dir: 'in' };
        await this.bankDb.ref().update(updates);
    }

    // =====================================================
    // 受け取る（QR / 請求 / リンク）
    // =====================================================
    _payUrl(amount, memo) {
        const base = location.origin + location.pathname;
        const p = new URLSearchParams();
        p.set('to', this.uid);
        if (amount) p.set('amt', String(amount));
        if (memo) p.set('memo', memo);
        return base + '?' + p.toString();
    }

    _openReceive() {
        this.els.invoiceAmount.value = '';
        this._show(this.els.receiveModal);
        this._renderReceiveQr(null);
    }

    _renderReceiveQr(amount) {
        const url = this._payUrl(amount, '');
        this._currentPayUrl = url;
        this.els.receiveQr.innerHTML = '';
        try {
            this._receiveQr = new QRCode(this.els.receiveQr, {
                text: url, width: 192, height: 192,
                colorDark: '#0E1626', colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        } catch (_) {
            this.els.receiveQr.textContent = 'QRの生成に失敗しました';
        }
    }

    async _copyPayLink() {
        try {
            await navigator.clipboard.writeText(this._currentPayUrl || this._payUrl(null, ''));
            this._toast('支払いリンクをコピーしました', 'success');
        } catch (_) {
            this._toast('コピーできませんでした', 'error');
        }
    }

    // =====================================================
    // 読み取る（スキャン）
    // =====================================================
    async _openScan() {
        this.els.scanPaste.value = '';
        this.els.scanStatus.textContent = 'カメラを起動しています…';
        this._show(this.els.scanModal);
        try {
            await this._loadHtml5Qr();
            this.els.scanRegion.innerHTML = '';
            this._scanner = new Html5Qrcode('scanRegion');
            await this._scanner.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: 200 },
                decoded => { this._stopScan(); this._handlePayUrl(decoded); },
                () => {}
            );
            this.els.scanStatus.textContent = 'QRコードをカメラに向けてください';
        } catch (e) {
            this.els.scanStatus.textContent = 'カメラを使えません。下のリンク貼り付けをご利用ください。';
        }
    }

    _loadHtml5Qr() {
        if (window.Html5Qrcode) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async _stopScan() {
        if (this._scanner) {
            try { await this._scanner.stop(); this._scanner.clear(); } catch (_) {}
            this._scanner = null;
        }
    }

    async _handlePayUrl(str) {
        if (!str) return;
        let to, amt, memo;
        try {
            const u = new URL(str, location.href);
            to = u.searchParams.get('to');
            amt = u.searchParams.get('amt');
            memo = u.searchParams.get('memo');
        } catch (_) {
            return this._toast('リンクを読み取れませんでした', 'error');
        }
        if (!to) return this._toast('支払い情報が見つかりません', 'error');
        const r = await this._resolveByUid(to);
        if (!r) return this._toast('相手の口座が見つかりません', 'error');
        if (r.uid === this.uid) return this._toast('自分宛のリンクです', 'info');
        this._closeModals();
        this._pendingPay = { uid: r.uid, name: r.name };
        this._openSend({ name: r.name, amount: amt ? parseInt(amt, 10) : '', memo: memo || '' });
    }

    _consumePayParams() {
        const p = new URLSearchParams(location.search);
        const to = p.get('to');
        if (!to) return;
        // URL をきれいにする
        history.replaceState(null, '', location.origin + location.pathname);
        this._handlePayUrl(location.origin + location.pathname + '?' + p.toString());
    }

    // =====================================================
    // 履歴
    // =====================================================
    _openHistory() { this._show(this.els.historyModal); this._renderHistory(); }

    _renderRecent() {
        const items = this.txCache.slice(0, 6);
        this.els.recentEmpty.hidden = items.length > 0;
        this.els.recentList.innerHTML = items.map(t => this._txRow(t)).join('');
    }
    _renderHistory() {
        this.els.historyEmpty.hidden = this.txCache.length > 0;
        this.els.historyList.innerHTML = this.txCache.map(t => this._txRow(t)).join('');
    }

    _txRow(t) {
        const incoming = t.dir === 'in';
        const mint = t.type === 'mint';
        const adjust = t.type === 'adjust';
        const gamble = t.type === 'quickone' || t.type === 'jumbo';
        const special = mint || adjust;
        // 掛け金（out）は金色、当選（in）は緑。発行/調整は従来どおり金色。
        const icCls = (special || (gamble && !incoming)) ? 'mint' : (incoming ? 'in' : 'out');
        const icon = adjust ? 'fa-sliders'
            : mint ? 'fa-coins'
            : t.type === 'quickone' ? 'fa-dice'
            : t.type === 'jumbo' ? 'fa-ticket'
            : (incoming ? 'fa-arrow-down' : 'fa-arrow-up');
        let who;
        if (mint) who = '発行' + (t.by ? '（' + this._esc(t.by) + '）' : '');
        else if (adjust) who = '残高調整' + (t.by ? '（' + this._esc(t.by) + '）' : '');
        else if (gamble) who = this._esc(t.memo || (t.type === 'quickone' ? 'QUICKONE' : 'ジャンボ宝くじ'));
        else if (incoming) who = this._esc(t.fromName || '不明') + ' から';
        else who = this._esc(t.toName || '不明') + ' へ';
        const sign = incoming ? '+' : '−';
        const amtCls = incoming ? 'in' : 'out';
        const showMemo = !gamble && t.memo;   // ギャンブルは who に説明が入るので重複回避
        const meta = [this._time(t.ts), showMemo ? this._esc(t.memo) : ''].filter(Boolean).join(' ・ ');
        return `<li class="tx">
            <span class="tx__ic tx__ic--${icCls}"><i class="fa-solid ${icon}"></i></span>
            <div class="tx__main">
                <div class="tx__who">${who}</div>
                <div class="tx__meta">${meta}</div>
            </div>
            <span class="tx__amt tx__amt--${amtCls}">${sign}${this._fmt(t.amount)} W</span>
        </li>`;
    }

    // =====================================================
    // 管理（発行 / 凍結）
    // =====================================================
    _isAdmin() { return this.name === (window.BANK_ADMIN_NAME || '管理者'); }

    _openAdmin() {
        if (!this._isAdmin()) return this._toast('管理者のみ利用できます', 'error');
        this._hide(this.els.mintError);
        this.els.mintTo.value = ''; this.els.mintAmount.value = ''; this.els.mintMemo.value = '';
        this._show(this.els.adminModal);
        this._watchAdminAccounts();
        this._watchAdminJumbo();
        this._refreshAdminHouse();
        this._loadRichExcluded().then(() => this._renderAdminRich());
    }

    _watchAdminAccounts() {
        this.bankDb.ref('accounts').on('value', snap => {
            const list = [];
            snap.forEach(ch => { const v = ch.val(); if (v && typeof v === 'object' && v.uid) list.push(v); });
            list.sort((a, b) => (b.balance || 0) - (a.balance || 0));
            this._adminAccounts = list;
            this.els.adminAccountEmpty.hidden = list.length > 0;
            this.els.adminAccountList.innerHTML = list.map(a => `
                <li class="acct ${a.frozen ? 'acct--frozen' : ''}">
                    <div class="acct__main">
                        <div class="acct__name">${this._esc(a.name)}</div>
                        <div class="acct__bal">${this._fmt(Math.floor(a.balance || 0))} W ・ #${this._esc(a.uid)}</div>
                    </div>
                    <div class="acct__actions">
                        <button class="acct__btn" data-edit="${this._esc(a.uid)}">残高</button>
                        <button class="acct__freeze" data-uid="${this._esc(a.uid)}" data-frozen="${a.frozen ? 1 : 0}">
                            ${a.frozen ? '解除' : '凍結'}
                        </button>
                    </div>
                </li>`).join('');
            this.els.adminAccountList.querySelectorAll('.acct__freeze').forEach(b => {
                b.addEventListener('click', () => this._toggleFreeze(b.dataset.uid, b.dataset.frozen === '1'));
            });
            this.els.adminAccountList.querySelectorAll('[data-edit]').forEach(b => {
                b.addEventListener('click', () => this._openEditBalance(b.dataset.edit));
            });
            this._renderAdminRich();
        });
    }

    _openEditBalance(uid) {
        const acc = (this._adminAccounts || []).find(a => a.uid === uid);
        if (!acc) return;
        this._editUid = uid;
        const cur = Math.floor(acc.balance || 0);
        this.els.editName.textContent = acc.name || uid;
        this.els.editCurrent.textContent = this._fmt(cur);
        this.els.editBalance.value = cur;
        this._hide(this.els.editError);
        this._show(this.els.adminEditModal);
        setTimeout(() => { this.els.editBalance.focus(); this.els.editBalance.select(); }, 50);
    }

    _closeEditModal() {
        this.els.adminEditModal.hidden = true;
        // 管理モーダルは開いたままなので背景スクロールロックは維持
    }

    async _onSaveBalance() {
        this._hide(this.els.editError);
        const uid = this._editUid;
        const acc = (this._adminAccounts || []).find(a => a.uid === uid);
        if (!acc) return this._showError(this.els.editError, '口座が見つかりません。');
        const newBal = this._intOrNull(this.els.editBalance.value);
        if (newBal === null || newBal < 0) return this._showError(this.els.editError, '0 以上の整数を入力してください。');
        const cur = Math.floor(acc.balance || 0);
        if (newBal === cur) return this._closeEditModal();

        const ok = await this._confirm(`${acc.name} さんの残高を ${this._fmt(cur)} → ${this._fmt(newBal)} W に変更しますか？`);
        if (!ok) return;

        this.els.editSaveBtn.disabled = true;
        const ref = this.bankDb.ref('accounts/' + uid);
        const cb = ref.on('value', () => {});
        try {
            await this._waitValue(ref);
            const res = await ref.transaction(a => { if (!a) return; a.balance = newBal; return a; });
            if (!res.committed) throw new Error('変更できませんでした。もう一度お試しください。');

            const delta = newBal - cur;
            const ts = Date.now();
            if (delta > 0) {
                await this._writeLedger({ type: 'adjust', amount: delta, toUid: uid, toName: acc.name, by: this.name, memo: '管理者による残高調整', ts }, null, uid);
            } else {
                await this._writeLedger({ type: 'adjust', amount: -delta, fromUid: uid, fromName: acc.name, by: this.name, memo: '管理者による残高調整', ts }, uid, null);
            }
            this._closeEditModal();
            this._toast(`${acc.name} さんの残高を ${this._fmt(newBal)} W に変更しました`, 'success');
        } catch (e) {
            this._showError(this.els.editError, e.message || '変更できませんでした。');
        } finally {
            this.els.editSaveBtn.disabled = false;
            ref.off('value', cb);
        }
    }

    async _onMint() {
        this._hide(this.els.mintError);
        const name = this.els.mintTo.value.trim();
        const amount = this._intOrNull(this.els.mintAmount.value);
        const memo = this.els.mintMemo.value.trim();
        if (!name) return this._showError(this.els.mintError, '発行先を入力してください。');
        if (!amount || amount < 1) return this._showError(this.els.mintError, '1 以上の金額を入力してください。');
        this.els.mintBtn.disabled = true;
        try {
            const r = await this._resolveByName(name);
            if (!r) throw new Error('「' + name + '」が見つかりません。');
            if (!r.uid) throw new Error('相手にまだ UID がありません。');
            const ok = await this._confirm(`${r.name} さんに ${this._fmt(amount)} W を発行しますか？`);
            if (!ok) return;
            await this._ensureBankAccount(r.uid, r.name);
            const acctRef = this.bankDb.ref('accounts/' + r.uid);
            try { await acctRef.get(); } catch (_) {}
            const res = await acctRef.transaction(acc => {
                if (!acc) return;
                acc.balance = (acc.balance || 0) + amount;
                return acc;
            });
            if (!res.committed) throw new Error('発行できませんでした。もう一度お試しください。');
            await this._writeLedger(
                { type: 'mint', amount, toUid: r.uid, toName: r.name, by: this.name, memo, ts: Date.now() },
                null, r.uid
            );
            this.els.mintAmount.value = ''; this.els.mintMemo.value = '';
            this._toast(`${r.name} さんに ${this._fmt(amount)} W を発行しました`, 'success');
        } catch (e) {
            this._showError(this.els.mintError, e.message || '発行できませんでした。');
        } finally {
            this.els.mintBtn.disabled = false;
        }
    }

    async _toggleFreeze(uid, currentlyFrozen) {
        const target = !currentlyFrozen;
        const ok = await this._confirm(target ? 'この口座を凍結しますか？' : 'この口座の凍結を解除しますか？');
        if (!ok) return;
        try {
            await this.bankDb.ref('accounts/' + uid + '/frozen').set(target);
            this._toast(target ? '凍結しました' : '凍結を解除しました', 'success');
        } catch (e) {
            this._toast('変更できませんでした', 'error');
        }
    }

    // =====================================================
    // 設定
    // =====================================================
    _loadSettings() {
        const def = { autoLogin: true, confirmSend: true };
        try { return { ...def, ...JSON.parse(localStorage.getItem('lunb_settings') || '{}') }; }
        catch { return def; }
    }
    _saveSettings() {
        localStorage.setItem('lunb_settings', JSON.stringify(this.settings));
    }
    _openSettings() {
        this.els.setAutoLogin.checked = !!this.settings.autoLogin;
        this.els.setConfirmSend.checked = !!this.settings.confirmSend;
        this.els.setName.textContent = this.name || '—';
        this.els.setUid.textContent = '#' + (this.uid || '');
        this.els.setAvatar.textContent = (this.name || '?').slice(0, 1).toUpperCase();
        this._show(this.els.settingsModal);
    }

    // =====================================================
    // サブスクリプション
    // =====================================================
    _intervalLabel(iv) { return iv === 'week' ? '毎週' : '毎月'; }
    _advance(ts, interval) {
        const d = new Date(ts || Date.now());
        if (interval === 'week') d.setDate(d.getDate() + 7);
        else d.setMonth(d.getMonth() + 1);
        return d.getTime();
    }
    _dateLabel(ts) {
        if (!ts) return '—';
        const d = new Date(ts);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }

    _openSubs() {
        this._show(this.els.subsModal);
        this._watchSubs();
    }

    _watchSubs() {
        this.bankDb.ref('subscriptions').on('value', snap => {
            const all = [];
            snap.forEach(ch => { all.push(ch.val()); });
            this.subsCache = all;
            this._renderSubs();
        });
    }

    _subState(s) {
        const now = Date.now();
        if (s.status === 'active') return 'active';
        if (s.status === 'canceled' && (s.validUntil || 0) > now) return 'stopping';
        return 'ended';
    }

    _renderSubs() {
        const paying = this.subsCache.filter(s => s.payerUid === this.uid && this._subState(s) !== 'ended')
            .sort((a, b) => (a.nextChargeAt || 0) - (b.nextChargeAt || 0));
        const receiving = this.subsCache.filter(s => s.payeeUid === this.uid && this._subState(s) !== 'ended')
            .sort((a, b) => (a.nextChargeAt || 0) - (b.nextChargeAt || 0));

        this.els.subPayingEmpty.hidden = paying.length > 0;
        this.els.subPayingList.innerHTML = paying.map(s => this._subRow(s, true)).join('');
        this.els.subPayingList.querySelectorAll('[data-sub]').forEach(b => {
            b.addEventListener('click', () => this._onSubStop(b.dataset.sub));
        });

        this.els.subReceivingWrap.hidden = receiving.length === 0;
        this.els.subReceivingList.innerHTML = receiving.map(s => this._subRow(s, false)).join('');
    }

    _subRow(s, payer) {
        const state = this._subState(s);
        const counterpart = payer
            ? ('提供 ' + this._esc(s.payeeName || '不明'))
            : ('利用者 ' + this._esc(s.payerName || '不明'));

        let badge, meta, actions = '';
        if (state === 'active') {
            badge = '<span class="badge badge--active">利用中</span>'
                + (s.overdue ? '<span class="badge badge--overdue">残高不足</span>' : '');
            meta = `${counterpart} ・ 次回請求 ${this._dateLabel(s.nextChargeAt)}（この日まで利用可能）`;
            if (payer) {
                actions = `<div class="sub__actions">
                    <button class="btn btn--ghost btn--small" data-sub="${this._esc(s.id)}">停止する</button>
                </div>`;
            }
        } else { // stopping（停止済み・期限まで有効）
            badge = '<span class="badge badge--paused">停止済み</span>';
            meta = `${counterpart} ・ ${this._dateLabel(s.validUntil)} まで利用可能`;
        }

        return `<li class="sub ${state === 'stopping' ? 'sub--paused' : ''}">
            <div class="sub__top">
                <span class="sub__name">${this._esc(s.name || 'サブスク')}</span>
                <span class="sub__amt">${this._fmt(s.amount)} W <small>/ ${this._intervalLabel(s.interval)}</small></span>
            </div>
            <div class="sub__meta">${meta}</div>
            <div class="sub__badges">${badge}</div>
            ${actions}
        </li>`;
    }

    async _onSubStop(id) {
        const sub = this.subsCache.find(s => s.id === id);
        if (!sub) return;
        const validUntil = sub.nextChargeAt || Date.now();
        const ok = await this._confirm(
            `「${sub.name}」を停止しますか？\n今後の請求は止まりますが、支払い済みの ${this._dateLabel(validUntil)} まではそのまま利用できます。`);
        if (!ok) return;
        try {
            await this.bankDb.ref('subscriptions/' + id).update({ status: 'canceled', validUntil, overdue: false });
            this._toast(`停止しました。${this._dateLabel(validUntil)} まで利用できます`, 'success', 4500);
        } catch (e) {
            this._toast('停止できませんでした', 'error');
        }
    }

    // アプリを開いている人が共通の課金エンジンになる：
    // 契約に無関係な人の端末でも、期日が来た全サブスクを処理する（ロックで二重課金を防止）。
    async _processDueSubscriptions() {
        try {
            const snap = await this.bankDb.ref('subscriptions').get();
            if (!snap.exists()) return;
            const now = Date.now();
            const due = [];
            snap.forEach(ch => {
                const s = ch.val();
                if (s && s.status === 'active' && (s.nextChargeAt || 0) <= now) due.push(s);
            });
            for (const s of due) await this._chargeSubscription(s);
        } catch (_) {}
    }

    // 1周期分だけ課金（多重起動はロックで防ぐ）
    async _chargeSubscription(sub) {
        const now = Date.now();
        const ref = this.bankDb.ref('subscriptions/' + sub.id);

        // 課金枠を確保（期日到来 & 直近ロックなしのときだけ lockAt を立てる）
        const claim = await ref.transaction(s => {
            if (!s || s.status !== 'active') return;
            if ((s.nextChargeAt || 0) > Date.now()) return;
            if (s.lockAt && Date.now() - s.lockAt < 60000) return;
            s.lockAt = Date.now();
            return s;
        });
        if (!claim.committed) return;
        const claimed = claim.snapshot.val();
        const dueAt = claimed.nextChargeAt || now;

        try {
            await this._ensureBankAccount(claimed.payeeUid, claimed.payeeName);
            let moved = false;
            try { moved = await this._moveFunds(claimed.payerUid, claimed.payeeUid, claimed.amount, claimed.payeeName); }
            catch (_) { moved = false; }
            if (moved) {
                await ref.update({
                    nextChargeAt: this._advance(dueAt, claimed.interval),
                    lastChargeAt: now, overdue: false, lockAt: null
                });
                await this._writeLedger({
                    type: 'subscription', amount: claimed.amount,
                    fromUid: claimed.payerUid, fromName: claimed.payerName,
                    toUid: claimed.payeeUid, toName: claimed.payeeName,
                    memo: claimed.name || 'サブスク', ts: now
                }, claimed.payerUid, claimed.payeeUid);
                if (claimed.payerUid === this.uid) {
                    this._toast(`「${claimed.name}」の引き落とし ${this._fmt(claimed.amount)} W を実行しました`, 'info', 4200);
                }
            } else {
                // 残高不足など → 期日は据え置き、次回開いたとき再試行
                await ref.update({ overdue: true, lockAt: null });
                if (claimed.payerUid === this.uid) {
                    this._toast(`「${claimed.name}」の引き落としに失敗（残高不足）`, 'error', 5000);
                }
            }
        } catch (e) {
            try { await ref.update({ lockAt: null }); } catch (_) {}
        }
    }

    // =====================================================
    // 名前/UID 解決
    // =====================================================
    async _resolveByName(name) {
        const acc = await this._getLinkupAccount(name);
        if (!acc) return null;
        return { name: acc.name, uid: acc.uid };
    }
    async _resolveByUid(uid) {
        try {
            const usnap = await this.authDb.ref('uids/' + uid).get();
            if (usnap.exists() && usnap.val().name) return { uid, name: usnap.val().name };
        } catch (_) {}
        try {
            const bsnap = await this.bankDb.ref('accounts/' + uid).get();
            if (bsnap.exists()) return { uid, name: bsnap.val().name || uid };
        } catch (_) {}
        return null;
    }

    // =====================================================
    // UI ヘルパ
    // =====================================================
    _show(el) {
        el.hidden = false;
        if (el.classList && el.classList.contains('modal')) document.documentElement.classList.add('no-scroll');
    }
    _hide(el) { el.hidden = true; }
    _showError(el, msg) { el.textContent = msg; el.hidden = false; }

    _closeModals() {
        document.querySelectorAll('.modal').forEach(m => {
            if (m.id === 'confirmModal') return;
            m.hidden = true;
        });
        // 管理画面で張った accounts(親) の監視だけ解除。自分の口座 accounts/{uid} の監視には影響しない。
        if (this.bankDb) { this.bankDb.ref('accounts').off('value'); this.bankDb.ref('subscriptions').off('value'); this.bankDb.ref('jumbo').off('value'); }
        this._stopScan();
        this._hideSuggest();
        document.documentElement.classList.remove('no-scroll');
        if (this.els.appScreen && !this.els.appScreen.hidden) this._setActiveNav('home');
    }

    _confirm(text) {
        return new Promise(resolve => {
            this.els.confirmText.textContent = text;
            this.els.confirmModal.hidden = false;
            const done = v => {
                this.els.confirmModal.hidden = true;
                this.els.confirmOk.onclick = null;
                this.els.confirmCancel.onclick = null;
                resolve(v);
            };
            this.els.confirmOk.onclick = () => done(true);
            this.els.confirmCancel.onclick = () => done(false);
        });
    }

    _toast(msg, type = 'info', dur = 3200) {
        const el = document.createElement('div');
        const ic = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
        el.className = 'toast toast--' + type;
        el.innerHTML = `<span class="toast__ic"><i class="fa-solid ${ic}"></i></span><span>${this._esc(msg)}</span>`;
        this.els.toastStack.appendChild(el);
        setTimeout(() => {
            el.classList.add('is-out');
            setTimeout(() => el.remove(), 260);
        }, dur);
    }

    _fmt(n) { return Number(n || 0).toLocaleString('ja-JP'); }
    _intOrNull(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
    _time(ts) {
        if (!ts) return '';
        const d = new Date(ts), now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        const hm = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
    }
    // =====================================================
    // 長者番付（残高ランキング）
    // =====================================================
    async _loadRichExcluded() {
        const ex = {};
        try {
            const s = await this.bankDb.ref('richExcluded').get();
            if (s.exists()) s.forEach(ch => { if (ch.val()) ex[ch.key] = true; });
        } catch (_) {}
        this._richExcluded = ex;
        return ex;
    }

    async _loadAllAccounts() {
        const list = [];
        try {
            const s = await this.bankDb.ref('accounts').get();
            if (s.exists()) s.forEach(ch => { const v = ch.val(); if (v && v.uid) list.push(v); });
        } catch (_) {}
        return list;
    }

    async _openRich() {
        this._show(this.els.richModal);
        this.els.richList.innerHTML = '<li class="rich-loading">読み込み中…</li>';
        const [accounts, excluded] = await Promise.all([this._loadAllAccounts(), this._loadRichExcluded()]);
        const ranked = accounts
            .filter(a => !excluded[a.uid])
            .sort((x, y) => (y.balance || 0) - (x.balance || 0));

        this.els.richEmpty.hidden = ranked.length > 0;
        const CAP = 200;
        const rows = ranked.slice(0, CAP).map((a, i) => {
            const rank = i + 1;
            const me = a.uid === this.uid ? ' is-me' : '';
            const medal = rank <= 3 ? ` rich-row--${rank}` : '';
            const rankCell = rank <= 3
                ? `<span class="rich-rank rich-rank--medal"><i class="fa-solid fa-crown"></i>${rank}</span>`
                : `<span class="rich-rank">${rank}</span>`;
            return `<li class="rich-row${medal}${me}">
                ${rankCell}
                <span class="rich-name">${this._esc(a.name || '不明')}${a.frozen ? ' <i class="fa-solid fa-snowflake rich-frozen" title="凍結中"></i>' : ''}</span>
                <span class="rich-bal">${this._fmt(a.balance || 0)} W</span>
            </li>`;
        }).join('');
        const more = ranked.length > CAP ? `<li class="muted-note" style="padding:10px 12px">ほか ${ranked.length - CAP} 件…</li>` : '';
        this.els.richList.innerHTML = rows + more;
    }

    // 管理: 除外設定の一覧を描画（_adminAccounts と _richExcluded から）
    _renderAdminRich() {
        if (!this.els.adminRichList) return;
        const accounts = (this._adminAccounts || []).slice().sort((x, y) => (y.balance || 0) - (x.balance || 0));
        const ex = this._richExcluded || {};
        this.els.adminRichEmpty.hidden = accounts.length > 0;
        this.els.adminRichList.innerHTML = accounts.map(a => {
            const excluded = !!ex[a.uid];
            const btn = excluded
                ? `<button class="acct__btn" data-richinc="${this._esc(a.uid)}">番付に戻す</button>`
                : `<button class="acct__freeze" data-richexc="${this._esc(a.uid)}">除外する</button>`;
            return `<li class="acct">
                <div class="acct__main">
                    <div class="acct__name">${this._esc(a.name || '不明')} ${excluded ? '<span class="badge badge--paused">除外中</span>' : ''}</div>
                    <div class="acct__bal">${this._fmt(a.balance || 0)} W</div>
                </div>
                <div class="acct__actions">${btn}</div>
            </li>`;
        }).join('');
        this.els.adminRichList.querySelectorAll('[data-richexc]').forEach(b => b.addEventListener('click', () => this._setRichExcluded(b.dataset.richexc, true)));
        this.els.adminRichList.querySelectorAll('[data-richinc]').forEach(b => b.addEventListener('click', () => this._setRichExcluded(b.dataset.richinc, false)));
    }

    async _setRichExcluded(uid, on) {
        if (!this._isAdmin()) return this._toast('管理者のみ利用できます', 'error');
        try {
            await this.bankDb.ref('richExcluded/' + uid).set(on ? true : null);
            this._richExcluded = this._richExcluded || {};
            if (on) this._richExcluded[uid] = true; else delete this._richExcluded[uid];
            this._renderAdminRich();
            this._toast(on ? '長者番付から除外しました' : '長者番付に戻しました', 'success');
        } catch (e) {
            this._toast('変更に失敗しました: ' + (e.message || ''), 'error');
        }
    }

    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // =====================================================
    // ギャンブル — 共通（システム口座 / 支払い）
    // =====================================================
    // 「宝くじ運営」「中央銀行」は既存のアカウント。名前から実UIDを解決して使う。
    //  1) LinkUp の名前解決（通常の送金先と同じ経路）
    //  2) 見つからなければ銀行口座を名前一致でフォールバック検索
    async _resolveSysAccount(name) {
        this._sysCache = this._sysCache || {};
        if (this._sysCache[name] && this._sysCache[name].uid) return this._sysCache[name];
        let r = null;
        try { r = await this._resolveByName(name); } catch (_) {}
        if (r && r.uid) { this._sysCache[name] = { uid: r.uid, name: r.name || name }; return this._sysCache[name]; }
        try {
            const snap = await this.bankDb.ref('accounts').get();
            let found = null;
            snap.forEach(ch => { const v = ch.val(); if (v && v.uid && v.name === name) found = { uid: v.uid, name: v.name }; });
            if (found) { this._sysCache[name] = found; return found; }
        } catch (_) {}
        return null;
    }
    _houseAccount()   { return this._resolveSysAccount(window.BANK_HOUSE_NAME   || '宝くじ運営'); }
    _centralAccount() { return this._resolveSysAccount(window.BANK_CENTRAL_NAME || '中央銀行'); }

    async _accountBalance(uid) {
        try { const s = await this.bankDb.ref('accounts/' + uid + '/balance').get(); return Math.floor(s.val() || 0); }
        catch (_) { return 0; }
    }

    // 掛け金を「宝くじ運営」口座へ集める（true=成功）
    //  ※ QUICKONE の購入は履歴に残さない（残高移動のみ。台帳には記録しない）
    async _collectStake(amount, memo, type) {
        const h = await this._houseAccount();
        if (!h) { this._toast('「宝くじ運営」口座が見つかりません。管理者に確認してください。', 'error', 5000); return false; }
        let moved = false;
        try { moved = await this._moveFunds(this.uid, h.uid, amount, h.name); } catch (_) { moved = false; }
        if (!moved) return false;
        if (type !== 'quickone') {
            try {
                await this._writeLedger({ type, amount, fromUid: this.uid, fromName: this.name, toUid: h.uid, toName: h.name, memo, ts: Date.now() }, this.uid, h.uid);
            } catch (_) {}
        }
        return true;
    }

    // 当選金を「運営 → 不足分のみ中央銀行」から支払う。実際に支払えた額を返す。
    async _payPrize(toUid, toName, amount, type, memo) {
        let remaining = Math.floor(amount);
        const h = await this._houseAccount();
        if (h) remaining = await this._payFromSource(h, toUid, toName, remaining, type, memo);
        if (remaining > 0) {
            const c = await this._centralAccount();
            if (c) remaining = await this._payFromSource(c, toUid, toName, remaining, type, memo);
        }
        return Math.floor(amount) - remaining;
    }

    async _payFromSource(src, toUid, toName, want, type, memo) {
        want = Math.floor(want);
        if (want <= 0) return 0;
        const bal = await this._accountBalance(src.uid);
        const pay = Math.min(want, bal);
        if (pay <= 0) return want;
        let moved = false;
        try { moved = await this._moveFunds(src.uid, toUid, pay, toName); } catch (_) { moved = false; }
        if (!moved) return want;
        // QUICKONE は購入も当選も履歴に残さない（残高移動のみ）。ジャンボ等は記録する。
        if (type !== 'quickone') {
            try {
                await this._writeLedger({ type, amount: pay, fromUid: src.uid, fromName: src.name, toUid, toName, memo, ts: Date.now() }, src.uid, toUid);
            } catch (_) {}
        }
        return want - pay;
    }

    _drawWeighted(tiers) {
        const total = tiers.reduce((s, t) => s + (t.weight || 0), 0);
        let r = Math.random() * total;
        for (const t of tiers) { if (r < (t.weight || 0)) return t; r -= (t.weight || 0); }
        return tiers[tiers.length - 1];
    }

    _randomDigits(n) {
        let s = '';
        for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
        return s;
    }

    // =====================================================
    // ギャンブル — ハブ
    // =====================================================
    _openGamble() {
        this._show(this.els.gambleModal);
        this._refreshHouseChips();
    }
    async _refreshHouseChips() {
        if (!this.els.gambleHouseInfo) return;
        try {
            const h = await this._houseAccount();
            const c = await this._centralAccount();
            const hb = h ? await this._accountBalance(h.uid) : 0;
            const cb = c ? await this._accountBalance(c.uid) : 0;
            this.els.gambleHouseInfo.textContent = `運営プール ${this._fmt(hb)} W ・ 中央銀行 ${this._fmt(cb)} W`;
        } catch (_) {}
    }

    // =====================================================
    // QUICKONE（スクラッチ式・即抽選）
    // =====================================================
    _quickoneCfg() {
        const def = {
            cost: 10,
            tiers: [
                { label: '1等', mult: 100, weight: 2 },
                { label: '2等', mult: 10, weight: 20 },
                { label: '3等', mult: 2, weight: 225 },
                { label: 'はずれ', mult: 0, weight: 753 }
            ]
        };
        const c = window.BANK_QUICKONE || {};
        return {
            cost: (typeof c.cost === 'number' && c.cost > 0) ? c.cost : def.cost,
            tiers: (Array.isArray(c.tiers) && c.tiers.length) ? c.tiers : def.tiers
        };
    }

    _openQuickone() {
        const cfg = this._quickoneCfg();
        this.els.quickoneCost.textContent = this._fmt(cfg.cost);
        this._renderQuickoneTable();
        this._resetQuickoneStage();
        this._show(this.els.quickoneModal);
    }

    // 選んだベット倍率（1〜1000）
    _quickoneBet() {
        let n = parseInt(this.els.quickoneBet && this.els.quickoneBet.value, 10);
        if (!Number.isFinite(n)) n = 1;
        return Math.max(1, Math.min(1000, n));
    }

    // 賞金表は「選んだベット倍率」に比例して表示額が変わる（当選時はこの金額がそのまま支払われる）
    _renderQuickoneTable() {
        if (!this.els.quickoneTable) return;
        const cfg = this._quickoneCfg();
        const bet = this._quickoneBet();
        const winners = cfg.tiers.filter(t => t.mult > 0);
        const total = cfg.tiers.reduce((s, t) => s + (t.weight || 0), 0) || 1;
        this.els.quickoneTable.innerHTML = winners.map(t => {
            const prize = cfg.cost * t.mult * bet;
            const pct = (t.weight || 0) / total * 100;
            const pctLabel = pct >= 1 ? pct.toFixed(0) : pct.toFixed(1);
            return `<li class="qo-tier">
                <span class="qo-tier__rank">${this._esc(t.label)}</span>
                <span class="qo-tier__mult">${t.mult}倍</span>
                <span class="qo-tier__prize">${this._fmt(prize)} W</span>
                <span class="qo-tier__pct">${pctLabel}%</span>
            </li>`;
        }).join('');
        if (this.els.quickonePrizeNote) {
            this.els.quickonePrizeNote.textContent = bet > 1
                ? `※ ベット ×${bet} 時の当選金です（掛け金 ${this._fmt(cfg.cost * bet)} W）`
                : '';
        }
    }

    _updateQuickoneCost() {
        this._renderQuickoneTable(); // ベット倍率に応じて賞金表も更新
        if (!this.els.quickonePlay || this.els.quickonePlay.disabled) return;
        const cfg = this._quickoneCfg();
        const bet = this._quickoneBet();
        const total = cfg.cost * bet;
        const label = bet > 1 ? `×${bet}（${this._fmt(total)} W）` : `${this._fmt(total)} W`;
        this.els.quickonePlay.innerHTML = this._qoPlayed
            ? `<i class="fa-solid fa-rotate-right"></i> もう一度（${label}）`
            : `<i class="fa-solid fa-wand-magic-sparkles"></i> ${label} でけずる`;
    }

    _resetQuickoneStage() {
        this._qoPlayed = false;
        this.els.quickoneResult.className = 'qo-result';
        this.els.quickoneResult.innerHTML = `<span class="qo-result__idle"><i class="fa-solid fa-ticket"></i> けずってみよう</span>`;
        this.els.quickonePlay.disabled = false;
        this._updateQuickoneCost();
    }

    async _playQuickone() {
        const cfg = this._quickoneCfg();
        const cost = cfg.cost;
        const bet = this._quickoneBet();
        const stake = cost * bet;
        if (this.els.quickoneBet) this.els.quickoneBet.value = bet; // 範囲を正規化して反映
        if (!this.account || this.account.frozen) return this._toast('口座が凍結されています', 'error');
        if ((this.account.balance || 0) < stake) return this._toast(`残高が足りません（${this._fmt(stake)} W 必要）`, 'error');

        this.els.quickonePlay.disabled = true;
        this.els.quickoneResult.className = 'qo-result is-spinning';
        this.els.quickoneResult.innerHTML = `<span class="qo-spin"><i class="fa-solid fa-dice"></i></span>`;

        // 掛け金（= 1回 × ベット倍率）を回収（履歴には残さない）
        const staked = await this._collectStake(stake, 'QUICKONE 購入', 'quickone');
        if (!staked) { this._toast('購入処理に失敗しました。もう一度お試しください。', 'error'); this._resetQuickoneStage(); return; }

        // 1回だけ抽選し、単一の結果（1等/2等/3等/はずれ）を出す。当選金はベット倍率に比例。
        const tier = this._drawWeighted(cfg.tiers);
        const prize = tier.mult > 0 ? cost * tier.mult * bet : 0;

        await new Promise(r => setTimeout(r, 850)); // 演出

        let paid = 0;
        if (prize > 0) paid = await this._payPrize(this.uid, this.name, prize, 'quickone', `QUICKONE ${tier.label} 当選`);

        const betLabel = bet > 1 ? `<span class="qo-result__sub">ベット ×${bet} ・ 掛け金 ${this._fmt(stake)} W</span>` : '';
        if (prize > 0) {
            this.els.quickoneResult.className = 'qo-result is-win';
            this.els.quickoneResult.innerHTML =
                `<span class="qo-result__rank">${this._esc(tier.label)} 当選！</span>
                 <span class="qo-result__amt">+${this._fmt(paid)} W</span>${betLabel}`;
            if (paid < prize) this._toast('運営の残高が不足し、一部のみの支払いです。管理者に連絡してください。', 'error', 5000);
            else this._toast(`${tier.label} 当選！ +${this._fmt(paid)} W`, 'success', 4000);
        } else {
            this.els.quickoneResult.className = 'qo-result is-lose';
            this.els.quickoneResult.innerHTML = `<span class="qo-result__rank">はずれ</span>${betLabel || '<span class="qo-result__sub">また挑戦してね</span>'}`;
        }

        this._qoPlayed = true;
        this.els.quickonePlay.disabled = false;
        this._updateQuickoneCost();
        this._refreshHouseChips();
    }

    // =====================================================
    // ジャンボ宝くじ（番号選択式・管理者開催）— 利用者
    // =====================================================
    _openJumbo() {
        this._show(this.els.jumboModal);
        this._watchJumbo();
    }

    _watchJumbo() {
        this.bankDb.ref('jumbo').on('value', snap => {
            const list = [];
            snap.forEach(ch => { const v = ch.val(); if (v) list.push({ ...v, _key: ch.key }); });
            list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            this._jumboDraws = list;
            this._renderJumbo();
        });
    }

    // 全券を1回だけ走査し、表示に必要な「軽いサマリー」だけを作る。
    //  - summary[drawId]: { sales, myCount, myWins{1,2,3}, myWinTotal }
    //  - mine[drawId]:    自分の券 [{number, tier}]（一覧モーダル用）
    //  - winners[drawId]: 当選券のみ [{name, number, tier}]（抽選済みのみ）
    async _scanJumboTickets(draws) {
        const drawMap = {};
        (draws || []).forEach(d => { drawMap[d.id || d._key] = d; });
        const summary = {}, mine = {}, winners = {};
        try {
            const snap = await this.bankDb.ref('jumboTickets').get();
            if (snap.exists()) {
                snap.forEach(drawCh => {
                    const did = drawCh.key;
                    const d = drawMap[did];
                    const drawn = d && d.status === 'drawn';
                    if (!summary[did]) summary[did] = { sales: 0, myCount: 0, myWins: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 }, myWinTotal: 0 };
                    drawCh.forEach(tCh => {
                        const t = tCh.val(); if (!t) return;
                        summary[did].sales++;
                        const tier = (drawn && d) ? this._jumboTier(d, t.number) : 0;
                        if (drawn && tier > 0) (winners[did] = winners[did] || []).push({ name: t.name, number: t.number, tier });
                        if (t.uid === this.uid) {
                            summary[did].myCount++;
                            (mine[did] = mine[did] || []).push({ number: t.number, tier });
                            if (tier > 0) { summary[did].myWins[tier]++; summary[did].myWinTotal++; }
                        }
                    });
                });
            }
        } catch (_) {}
        return { summary, mine, winners };
    }

    // 当選番号は等ごとに複数指定できる（スペース/カンマ/読点区切り）
    _parseNums(s) {
        return String(s == null ? '' : s).split(/[\s,、，]+/).map(x => x.trim()).filter(Boolean);
    }

    _jumboTier(draw, number) {
        for (let n = 1; n <= 8; n++) {
            if (this._parseNums(draw['win' + n]).includes(number)) return n;
        }
        return 0;
    }

    async _renderJumbo() {
        const draws = this._jumboDraws || [];
        const { summary, mine, winners } = await this._scanJumboTickets(draws);
        this._jumboMine = mine;        // 一覧モーダル用に保持
        this._jumboWinners = winners;  // （未使用だが保持）
        const idOf = d => d.id || d._key;
        const sumOf = id => summary[id] || { sales: 0, myCount: 0, myWins: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 }, myWinTotal: 0 };
        // 販売終了でも自分の券があれば表示
        const visible = draws.filter(d => d.status !== 'closed' || sumOf(idOf(d)).myCount > 0);

        this.els.jumboEmpty.hidden = visible.length > 0;
        this.els.jumboList.innerHTML = visible.map(d => this._jumboCard(d, sumOf(idOf(d)), winners[idOf(d)] || [])).join('');

        this.els.jumboList.querySelectorAll('[data-buy]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.buy;
                const draw = (this._jumboDraws || []).find(x => (x.id || x._key) === id);
                const inp = this.els.jumboList.querySelector(`input[data-num="${id}"]`);
                if (draw && inp) this._buyJumboTicket(draw, (inp.value || '').trim());
            });
        });
        this.els.jumboList.querySelectorAll('[data-rand]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.rand;
                const draw = (this._jumboDraws || []).find(x => (x.id || x._key) === id);
                const inp = this.els.jumboList.querySelector(`input[data-num="${id}"]`);
                if (draw && inp) inp.value = this._randomDigits(draw.digits);
            });
        });
        this.els.jumboList.querySelectorAll('[data-bulkset]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.bulkset;
                const inp = this.els.jumboList.querySelector(`input[data-bulk="${id}"]`);
                if (inp) inp.value = btn.dataset.q;
            });
        });
        this.els.jumboList.querySelectorAll('[data-bulkbuy]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.bulkbuy;
                const draw = (this._jumboDraws || []).find(x => (x.id || x._key) === id);
                const inp = this.els.jumboList.querySelector(`input[data-bulk="${id}"]`);
                if (draw && inp) this._buyJumboBulk(draw, parseInt(inp.value, 10));
            });
        });
        this.els.jumboList.querySelectorAll('[data-mytickets]').forEach(btn => {
            btn.addEventListener('click', () => this._openMyTickets(btn.dataset.mytickets));
        });
    }

    _jumboCard(d, sum, winners) {
        const id = d.id || d._key;
        const drawn = d.status === 'drawn';
        const closed = d.status === 'closed';
        const open = d.status === 'open';

        const prizes = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ n, amt: d['prize' + n] || 0 })).filter(p => p.amt > 0);
        const prizeRows = prizes.map(p =>
            `<div class="jb-prize"><span class="jb-prize__rank">${p.n}等</span><b>${this._fmt(p.amt)} W</b>` +
            (drawn ? `<span class="jb-prize__win">当選 ${this._esc(this._parseNums(d['win' + p.n]).join('・') || '—')}</span>` : '') +
            `</div>`
        ).join('');

        // 自分の券は「件数＋ボタン」だけ表示（重くならないように一覧は出さない）
        let mine = '';
        if (sum.myCount > 0) {
            const winLabel = (drawn && sum.myWinTotal > 0)
                ? ` ・ <span class="jb-mine__win">当選 ${sum.myWinTotal}口</span>`
                : (drawn ? ' ・ 当選なし' : '');
            mine = `<div class="jb-mine">
                <div class="jb-mine__row">
                    <span class="jb-mine__title">あなたの券：${sum.myCount}口${winLabel}</span>
                    <button class="btn btn--ghost btn--small" data-mytickets="${this._esc(id)}">購入した券を表示</button>
                </div>
            </div>`;
        }

        let buy = '';
        if (open) {
            buy = `<div class="jb-buy">
                <input type="text" inputmode="numeric" data-num="${this._esc(id)}" maxlength="${d.digits}" placeholder="${'0'.repeat(d.digits)}" class="jb-num">
                <button class="btn btn--ghost btn--small" data-rand="${this._esc(id)}">おまかせ</button>
                <button class="btn btn--primary btn--small" data-buy="${this._esc(id)}">1口 ${this._fmt(d.ticketPrice)} W</button>
            </div>
            <div class="jb-bulk">
                <span class="jb-bulk__label"><i class="fa-solid fa-shuffle"></i> おまかせ一括</span>
                <input type="number" class="jb-bulkqty" data-bulk="${this._esc(id)}" min="1" max="1000" step="1" value="10" inputmode="numeric">
                <span class="jb-bulk__unit">口</span>
                <button type="button" class="qo-chip jb-bulk__chip" data-bulkset="${this._esc(id)}" data-q="10">10</button>
                <button type="button" class="qo-chip jb-bulk__chip" data-bulkset="${this._esc(id)}" data-q="100">100</button>
                <button class="btn btn--primary btn--small" data-bulkbuy="${this._esc(id)}">まとめて購入</button>
            </div>`;
        }

        // 当選者一覧（抽選済みのみ・全員が閲覧可）。多すぎる場合は先頭のみ描画。
        let winnersHtml = '';
        if (drawn) {
            const wins = (winners || []).slice().sort((a, b) => a.tier - b.tier);
            const CAP = 200;
            const shown = wins.slice(0, CAP);
            const rows = shown.map(w =>
                `<li class="jb-winner">
                    <span class="jb-winner__rank jb-winner__rank--${w.tier}">${w.tier}等</span>
                    <span class="jb-winner__name">${this._esc(w.name || '不明')}</span>
                    <span class="jb-winner__num">${this._esc(w.number)}</span>
                    <span class="jb-winner__prize">${this._fmt(d['prize' + w.tier] || 0)} W</span>
                </li>`
            ).join('');
            const more = wins.length > CAP ? `<li class="muted-note" style="padding:8px 11px">ほか ${wins.length - CAP} 名…</li>` : '';
            const body = wins.length
                ? `<ul class="jb-winners">${rows}${more}</ul>`
                : `<p class="muted-note" style="margin:8px 0 4px">当選者はいませんでした。</p>`;
            winnersHtml = `<details class="jb-details">
                <summary class="jb-summary"><i class="fa-solid fa-trophy"></i> 当選者を見る（${wins.length}名）</summary>
                ${body}
            </details>`;
        }

        const statusBadge = drawn
            ? '<span class="badge badge--paused">抽選済み</span>'
            : closed ? '<span class="badge badge--paused">販売終了</span>'
            : '<span class="badge badge--active">販売中</span>';

        return `<li class="jb-card">
            <div class="jb-card__head">
                <span class="jb-card__name">${this._esc(d.name)}</span>
                ${statusBadge}
            </div>
            <div class="jb-card__meta">${d.digits}桁の番号 ・ 1口 ${this._fmt(d.ticketPrice)} W ・ 販売 ${sum.sales}口</div>
            <div class="jb-prizes">${prizeRows || '<span class="muted-note">賞金は未設定です</span>'}</div>
            ${buy}
            ${mine}
            ${winnersHtml}
        </li>`;
    }

    // 「購入した券を表示」モーダル。番号は軽量に（当選券はチップ、その他はまとめて表示）。
    _openMyTickets(drawId) {
        const d = (this._jumboDraws || []).find(x => (x.id || x._key) === drawId);
        const list = (this._jumboMine && this._jumboMine[drawId]) || [];
        if (!d) return;
        const drawn = d.status === 'drawn';
        this.els.myTicketsTitle.textContent = d.name;

        const winCount = list.filter(t => t.tier > 0).length;
        this.els.myTicketsSummary.textContent = `購入 ${list.length}口` + (drawn ? ` ・ 当選 ${winCount}口` : '');

        let html = '';
        if (drawn) {
            const wins = list.filter(t => t.tier > 0).sort((a, b) => a.tier - b.tier);
            if (wins.length) {
                const chips = wins.map(t => `<span class="jb-ticket is-win">${this._esc(t.number)} <b>${t.tier}等</b></span>`).join('');
                html += `<div class="jb-mine__title" style="margin-bottom:6px">当選した券</div><div class="jb-tickets">${chips}</div>`;
            }
            const losers = list.filter(t => t.tier === 0).map(t => t.number);
            html += `<div class="jb-mine__title" style="margin:14px 0 6px">はずれの番号（${losers.length}）</div>`;
            html += `<p class="jb-numtext">${this._renderNumText(losers)}</p>`;
        } else {
            const nums = list.map(t => t.number);
            html += `<div class="jb-mine__title" style="margin-bottom:6px">購入した番号（${nums.length}）</div>`;
            html += `<p class="jb-numtext">${this._renderNumText(nums)}</p>`;
        }
        this.els.myTicketsBody.innerHTML = html || '<p class="empty">券がありません。</p>';
        this._show(this.els.jumboTicketsModal);
    }

    // 大量の番号は個別DOMにせずテキストで表示（上限を超えたら省略）
    _renderNumText(nums) {
        const CAP = 3000;
        const shown = nums.slice(0, CAP).map(n => this._esc(n)).join('、');
        const more = nums.length > CAP ? ` …ほか ${nums.length - CAP} 件` : '';
        return shown ? shown + more : '—';
    }

    async _buyJumboTicket(draw, number) {
        const id = draw.id || draw._key;
        if (draw.status !== 'open') return this._toast('この宝くじは販売していません', 'error');
        if (!/^[0-9]+$/.test(number) || number.length !== draw.digits) {
            return this._toast(`${draw.digits}桁の数字を入力してください`, 'error');
        }
        if (!this.account || this.account.frozen) return this._toast('口座が凍結されています', 'error');
        if ((this.account.balance || 0) < draw.ticketPrice) return this._toast('残高が足りません', 'error');

        const ok = await this._confirm(`「${draw.name}」を番号 ${number} で 1口（${this._fmt(draw.ticketPrice)} W）購入しますか？`);
        if (!ok) return;

        const tRef = this.bankDb.ref('jumboTickets/' + id).push();
        const tKey = tRef.key;

        const staked = await this._collectStake(draw.ticketPrice, `${draw.name} 購入(${number})`, 'jumbo');
        if (!staked) return this._toast('購入に失敗しました', 'error');

        try {
            await tRef.set({ id: tKey, drawId: id, uid: this.uid, name: this.name, number, ts: Date.now() });
            this._toast(`購入しました（番号 ${number}）`, 'success');
            this._renderJumbo();
        } catch (e) {
            // 券の発行に失敗 → 掛け金を返金
            try { const h = await this._houseAccount(); if (h) await this._payFromSource(h, this.uid, this.name, draw.ticketPrice, 'jumbo', `${draw.name} 返金`); } catch (_) {}
            this._toast('購入に失敗しました。返金しました。', 'error');
        }
    }

    // おまかせ一括購入（ランダムな番号で複数口を一度に・上限1000）
    async _buyJumboBulk(draw, qtyRaw) {
        const id = draw.id || draw._key;
        if (draw.status !== 'open') return this._toast('この宝くじは販売していません', 'error');
        let qty = parseInt(qtyRaw, 10);
        if (!Number.isFinite(qty) || qty < 1) qty = 1;
        qty = Math.min(1000, qty);
        if (!this.account || this.account.frozen) return this._toast('口座が凍結されています', 'error');
        const total = draw.ticketPrice * qty;
        if ((this.account.balance || 0) < total) return this._toast(`残高が足りません（${this._fmt(total)} W 必要）`, 'error');

        const ok = await this._confirm(`「${draw.name}」をおまかせ（ランダム番号）で ${qty}口、合計 ${this._fmt(total)} W で購入しますか？`);
        if (!ok) return;

        // 券をまとめて生成（プッシュキーはクライアントで採番し、1回のupdateで書き込む）
        const base = this.bankDb.ref('jumboTickets/' + id);
        const updates = {};
        for (let i = 0; i < qty; i++) {
            const key = base.push().key;
            updates[key] = { id: key, drawId: id, uid: this.uid, name: this.name, number: this._randomDigits(draw.digits), ts: Date.now() };
        }

        const staked = await this._collectStake(total, `${draw.name} おまかせ${qty}口`, 'jumbo');
        if (!staked) return this._toast('購入に失敗しました', 'error');

        try {
            await base.update(updates);
            this._toast(`おまかせで ${qty}口 購入しました`, 'success', 4000);
            this._renderJumbo();
        } catch (e) {
            // 失敗時は掛け金を返金
            try { const h = await this._houseAccount(); if (h) await this._payFromSource(h, this.uid, this.name, total, 'jumbo', `${draw.name} 返金`); } catch (_) {}
            this._toast('購入に失敗しました。返金しました。', 'error');
        }
    }
    // =====================================================
    _watchAdminJumbo() {
        this.bankDb.ref('jumbo').on('value', snap => {
            const list = [];
            snap.forEach(ch => { const v = ch.val(); if (v) list.push({ ...v, _key: ch.key }); });
            list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            this._adminJumbo = list;
            if (!this.els.adminJumboList) return;
            this.els.adminJumboEmpty.hidden = list.length > 0;
            this.els.adminJumboList.innerHTML = list.map(d => {
                const id = d.id || d._key;
                const drawn = d.status === 'drawn', closed = d.status === 'closed';
                const statusLabel = drawn ? '抽選済み' : closed ? '販売終了' : '販売中';
                let actions = '';
                actions += `<button class="acct__freeze" data-jedit="${this._esc(id)}">金額変更</button>`;
                if (!drawn) {
                    if (!closed) actions += `<button class="acct__freeze" data-jclose="${this._esc(id)}">販売終了</button>`;
                    actions += `<button class="acct__btn" data-jdraw="${this._esc(id)}">当選番号を確定</button>`;
                } else {
                    actions += `<button class="acct__freeze" data-jview="${this._esc(id)}">当選者を見る</button>`;
                }
                return `<li class="acct">
                    <div class="acct__main">
                        <div class="acct__name">${this._esc(d.name)} <span class="badge ${(drawn || closed) ? 'badge--paused' : 'badge--active'}">${statusLabel}</span></div>
                        <div class="acct__bal">${d.digits}桁 ・ 1口 ${this._fmt(d.ticketPrice)} W</div>
                    </div>
                    <div class="acct__actions">${actions}</div>
                </li>`;
            }).join('');
            this.els.adminJumboList.querySelectorAll('[data-jdraw]').forEach(b => b.addEventListener('click', () => this._openJumboDraw(b.dataset.jdraw)));
            this.els.adminJumboList.querySelectorAll('[data-jclose]').forEach(b => b.addEventListener('click', () => this._closeJumboSales(b.dataset.jclose)));
            this.els.adminJumboList.querySelectorAll('[data-jview]').forEach(b => b.addEventListener('click', () => { this._closeModals(); this._openJumbo(); }));
            this.els.adminJumboList.querySelectorAll('[data-jedit]').forEach(b => b.addEventListener('click', () => this._openJumboEdit(b.dataset.jedit)));
        });
    }

    async _refreshAdminHouse() {
        const h = await this._houseAccount();
        const c = await this._centralAccount();
        if (this.els.adminHouseBal) this.els.adminHouseBal.textContent = this._fmt(h ? await this._accountBalance(h.uid) : 0) + ' W';
        if (this.els.adminCentralBal) this.els.adminCentralBal.textContent = this._fmt(c ? await this._accountBalance(c.uid) : 0) + ' W';
    }

    _openJumboCreate() {
        if (!this._isAdmin()) return this._toast('管理者のみ利用できます', 'error');
        this.els.jcName.value = '';
        this.els.jcDigits.value = '3';
        this.els.jcPrice.value = '';
        [1, 2, 3, 4, 5, 6, 7, 8].forEach(n => { this.els['jcPrize' + n].value = ''; });
        this._hide(this.els.jcError);
        this._show(this.els.jumboCreateModal);
    }

    async _createJumboDraw() {
        this._hide(this.els.jcError);
        const name = (this.els.jcName.value || '').trim();
        const digits = this._intOrNull(this.els.jcDigits.value);
        const price = this._intOrNull(this.els.jcPrice.value);
        const prizes = [1, 2, 3, 4, 5, 6, 7, 8].map(n => this._intOrNull(this.els['jcPrize' + n].value) || 0);
        if (!name) return this._showError(this.els.jcError, '名前を入力してください。');
        if (!digits || digits < 1 || digits > 6) return this._showError(this.els.jcError, '桁数は 1〜6 で入力してください。');
        if (!price || price < 1) return this._showError(this.els.jcError, '1口の値段（1以上）を入力してください。');
        if (prizes.reduce((a, b) => a + b, 0) <= 0) return this._showError(this.els.jcError, '少なくとも1つの賞金を設定してください。');

        const ref = this.bankDb.ref('jumbo').push();
        const id = ref.key;
        this.els.jcCreate.disabled = true;
        try {
            const data = { id, name, digits, ticketPrice: price, status: 'open', createdAt: Date.now(), by: this.name };
            prizes.forEach((v, i) => { data['prize' + (i + 1)] = v; });
            await ref.set(data);
            this._toast(`「${name}」を開催しました`, 'success');
            this.els.jumboCreateModal.hidden = true;
        } catch (e) {
            this._showError(this.els.jcError, '開催できませんでした: ' + (e.message || ''));
        } finally {
            this.els.jcCreate.disabled = false;
        }
    }

    _openJumboDraw(id) {
        const d = (this._adminJumbo || this._jumboDraws || []).find(x => (x.id || x._key) === id);
        if (!d) return;
        this._drawingId = id;
        this.els.jdTitle.textContent = d.name;
        this.els.jdHint.textContent = `${d.digits}桁の当選番号を入力（賞金のない等は入力不可）。複数指定する場合はスペースまたはカンマで区切ってください。`;
        [['jdWin1', 'win1', 'prize1'], ['jdWin2', 'win2', 'prize2'], ['jdWin3', 'win3', 'prize3'], ['jdWin4', 'win4', 'prize4'], ['jdWin5', 'win5', 'prize5'], ['jdWin6', 'win6', 'prize6'], ['jdWin7', 'win7', 'prize7'], ['jdWin8', 'win8', 'prize8']].forEach(([el, w, p]) => {
            const input = this.els[el];
            input.value = d[w] || '';
            input.removeAttribute('maxlength');
            input.disabled = !(d[p] > 0);
            const ex = '0'.repeat(d.digits);
            input.placeholder = (d[p] > 0) ? `${ex}, ${ex}（複数可）` : '（賞金なし）';
        });
        this._hide(this.els.jdError);
        this._show(this.els.jumboDrawModal);
    }

    async _finalizeJumboDraw() {
        const id = this._drawingId;
        const d = (this._adminJumbo || this._jumboDraws || []).find(x => (x.id || x._key) === id);
        if (!d) return;
        this._hide(this.els.jdError);
        // 各等を「複数番号リスト」として検証し、正規化（カンマ区切り）して保存
        const norm = {};
        const validList = (raw, prize, key) => {
            if (!prize) return true;
            const nums = this._parseNums(raw);
            if (nums.length < 1) return false;
            if (!nums.every(n => /^[0-9]+$/.test(n) && n.length === d.digits)) return false;
            norm[key] = [...new Set(nums)].join(','); // 重複除去して保存
            return true;
        };
        const oks = [1, 2, 3, 4, 5, 6, 7, 8].map(n => validList(this.els['jdWin' + n].value, d['prize' + n], 'win' + n));
        if (oks.some(ok => !ok)) {
            return this._showError(this.els.jdError, `当選番号は ${d.digits}桁の数字で入力してください（複数可・スペース/カンマ区切り）。`);
        }
        const ok = await this._confirm(`「${d.name}」の当選番号を確定します。よろしいですか？\n（確定後は変更できません。賞金は当選者へ手動で送金してください）`);
        if (!ok) return;

        this.els.jdConfirm.disabled = true;
        try {
            const upd = { status: 'drawn', drawnAt: Date.now() };
            [1, 2, 3, 4, 5, 6, 7, 8].forEach(n => { if (d['prize' + n] > 0) upd['win' + n] = norm['win' + n]; });
            await this.bankDb.ref('jumbo/' + id).update(upd);
            this._toast('当選番号を確定しました。当選者一覧から確認できます', 'success', 4500);
            this.els.jumboDrawModal.hidden = true;
        } catch (e) {
            this._showError(this.els.jdError, '確定に失敗しました: ' + (e.message || ''));
        } finally {
            this.els.jdConfirm.disabled = false;
        }
    }

    // 金額（1口の値段・各等の賞金）を後から変更する
    _openJumboEdit(id) {
        if (!this._isAdmin()) return this._toast('管理者のみ利用できます', 'error');
        const d = (this._adminJumbo || this._jumboDraws || []).find(x => (x.id || x._key) === id);
        if (!d) return;
        this._editingJumboId = id;
        this.els.jeTitle.textContent = d.name;
        this.els.jePrice.value = d.ticketPrice || '';
        [1, 2, 3, 4, 5, 6, 7, 8].forEach(n => { this.els['jePrize' + n].value = (d['prize' + n] || 0) || ''; });
        this._hide(this.els.jeError);
        this._show(this.els.jumboEditModal);
    }

    async _saveJumboEdit() {
        const id = this._editingJumboId;
        const d = (this._adminJumbo || this._jumboDraws || []).find(x => (x.id || x._key) === id);
        if (!d) return;
        this._hide(this.els.jeError);
        const price = this._intOrNull(this.els.jePrice.value);
        if (!price || price < 1) return this._showError(this.els.jeError, '1口の値段（1以上）を入力してください。');
        const prizes = [1, 2, 3, 4, 5, 6, 7, 8].map(n => this._intOrNull(this.els['jePrize' + n].value) || 0);
        if (prizes.reduce((a, b) => a + b, 0) <= 0) return this._showError(this.els.jeError, '少なくとも1つの賞金を設定してください。');

        this.els.jeSave.disabled = true;
        try {
            const upd = { ticketPrice: price };
            prizes.forEach((v, i) => { upd['prize' + (i + 1)] = v; });
            await this.bankDb.ref('jumbo/' + id).update(upd);
            this._toast('金額を変更しました', 'success');
            this.els.jumboEditModal.hidden = true;
        } catch (e) {
            this._showError(this.els.jeError, '変更に失敗しました: ' + (e.message || ''));
        } finally {
            this.els.jeSave.disabled = false;
        }
    }

    async _closeJumboSales(id) {
        const ok = await this._confirm('この宝くじの販売を終了しますか？（購入できなくなります。抽選はあとから行えます）');
        if (!ok) return;
        try { await this.bankDb.ref('jumbo/' + id + '/status').set('closed'); this._toast('販売を終了しました', 'success'); }
        catch (_) { this._toast('変更できませんでした', 'error'); }
    }
}

window.LinkUpNetBank = LinkUpNetBank;
