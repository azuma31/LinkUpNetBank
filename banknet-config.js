// =====================================================
// LinkUpNetBank 設定ファイル
// =====================================================
// このアプリは「2つの Firebase プロジェクト」を使います。
//
//  (A) LinkUp 本体のプロジェクト（linkup5）
//      → ログイン照合に使用。アカウント情報の "読み取り" だけ行います。
//        （linkup5 の accounts は .read:true で公開されているため、
//         名前 + パスワード(simpleHash) をクライアントで照合できます）
//
//  (B) LinkUpNetBank 専用の新規プロジェクト
//      → 残高・取引履歴・請求などの "銀行データ" を保存します。
//
// ★ セットアップ手順 ★
//  1. Firebase コンソールで新しいプロジェクトを作成
//  2.「Realtime Database」を有効化
//  3.「Authentication」→「ログイン方法」で【匿名】を有効化
//     （セキュリティルールで auth!=null を要求するため必須）
//  4.「プロジェクトの設定」→「マイアプリ」(ウェブ) の firebaseConfig を
//     下の BANK_CONFIG に貼り付け
//  5. database.rules.json の内容を Realtime Database のルールに設定
// =====================================================

// (A) LinkUp 本体（ログイン照合用・読み取りのみ）。通常このままでOK。
window.LINKUP_CONFIG = {
    apiKey: "AIzaSyAVhJVvMFoQafCkkZmb4n8dXLQu7X-pke8",
    authDomain: "linkup5.firebaseapp.com",
    projectId: "linkup5",
    storageBucket: "linkup5.firebasestorage.app",
    messagingSenderId: "612158108179",
    appId: "1:612158108179:web:dd0b16a18bbbe8107ac5e6",
    measurementId: "G-ZZR9FV3DXJ"
};

// (B) LinkUpNetBank 専用プロジェクト（★ここを自分の設定に書き換える）
window.BANK_CONFIG = {
    apiKey: "AIzaSyBkyyydEB8i0kO7zKGJ4Aq5E2FSDMlYdp4",
    authDomain: "linkupnetbank.firebaseapp.com",
    databaseURL: "https://linkupnetbank-default-rtdb.firebaseio.com",
    projectId: "linkupnetbank",
    storageBucket: "linkupnetbank.firebasestorage.app",
    messagingSenderId: "336102589888",
    appId: "1:336102589888:web:2a517d5ba5fc862c53b425",
    measurementId: "G-3P7K2MZCG6"
};

// 管理者として扱う LinkUp ユーザー名（発行・凍結が可能）
window.BANK_ADMIN_NAME = '管理者';

// 通貨単位
window.BANK_CURRENCY = 'W';

// =====================================================
// ギャンブル（宝くじ）設定
// =====================================================
// 当選金の出どころとなる「既存アカウント」の名前。
//  - 掛け金はすべて「宝くじ運営」口座に集まり、当選金（QUICKONE）もここから支払われます。
//  - 運営の残高が足りないときだけ「中央銀行」口座から不足分を支払います。
//  ★ これらは “すでに存在するアカウント” を名前で解決して使います（新規作成はしません）。
//    名前を変更している場合は下の2つを実際のアカウント名に合わせてください。
window.BANK_HOUSE_NAME   = '宝くじ運営';   // 掛け金プール兼・当選金の支払元
window.BANK_CENTRAL_NAME = '中央銀行';     // 不足分の補填元

// QUICKONE（いつでもスクラッチ宝くじ）
//  - cost: 1回の掛け金（W）
//  - tiers: 当選テーブル。prize = cost × mult。weight は抽選の重み（合計に対する割合で確率が決まる）
//  現在: 還元率 ≒ 59%  → (30×3 + 5×40 + 2×150) / 1000 = 590/1000
window.BANK_QUICKONE = {
    cost: 10,
    tiers: [
        { label: '1等',   mult: 30, weight: 10   }, // 1.0%  → 300 W
        { label: '2等',   mult: 5,  weight: 40  }, // 4.0%  → 50 W
        { label: '3等',   mult: 2,  weight: 150 }, // 15.0% → 20 W
        { label: 'はずれ', mult: 0,  weight: 800 }  // 80.7%
    ]
};
