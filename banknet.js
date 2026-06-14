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
    }

    _action(a) {
        if (a === 'home') { this._closeModals(); this._setActiveNav('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        else if (a === 'send') this._openSend();
        else if (a === 'receive') this._openReceive();
        else if (a === 'scan') this._openScan();
        else if (a === 'history') { this._setActiveNav('history'); this._openHistory(); }
        else if (a === 'admin') { this._setActiveNav('admin'); this._openAdmin(); }
        else if (a === 'subs') { this._setActiveNav('subs'); this._openSubs(); }
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
            this.txCache = Object.values(obj).sort((a, b) => b.ts - a.ts);
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
        const special = mint || adjust;
        const icCls = special ? 'mint' : (incoming ? 'in' : 'out');
        const icon = adjust ? 'fa-sliders' : (mint ? 'fa-coins' : (incoming ? 'fa-arrow-down' : 'fa-arrow-up'));
        let who;
        if (mint) who = '発行' + (t.by ? '（' + this._esc(t.by) + '）' : '');
        else if (adjust) who = '残高調整' + (t.by ? '（' + this._esc(t.by) + '）' : '');
        else if (incoming) who = this._esc(t.fromName || '不明') + ' から';
        else who = this._esc(t.toName || '不明') + ' へ';
        const sign = incoming ? '+' : '−';
        const amtCls = incoming ? 'in' : 'out';
        const meta = [this._time(t.ts), t.memo ? this._esc(t.memo) : ''].filter(Boolean).join(' ・ ');
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
        if (this.bankDb) { this.bankDb.ref('accounts').off('value'); this.bankDb.ref('subscriptions').off('value'); }
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
    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
}

window.LinkUpNetBank = LinkUpNetBank;
