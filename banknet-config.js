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
//  現在: 1等1% / 2等4% / 3等15% / はずれ80%  → 還元率 (30×10 + 5×40 + 2×150)/1000 = 800/1000 = 80%
window.BANK_QUICKONE = {
    cost: 10,
    tiers: [
        { label: '1等',   mult: 30, weight: 10  }, // 1.0%  → 300 W
        { label: '2等',   mult: 5,  weight: 40  }, // 4.0%  → 50 W
        { label: '3等',   mult: 2,  weight: 150 }, // 15.0% → 20 W
        { label: 'はずれ', mult: 0,  weight: 800 }  // 80.0%
    ]
};

// スロット（3リール・自分でストップ）
//  - cost: 1回の基本掛け金（W）。ベット倍率に応じて掛け金・賞金が増えます。
//  - reel: 3リール共通のシンボル構成。weight は出現の重み（合計20）。
//          three は「3つ揃い」したときの払戻倍率（掛け金に対する倍率）。
//          label は当選等級（1等/2等/3等）。three:0 のシンボルははずれ枠。
//  掛け金はすべて「宝くじ運営」口座に集まり、当選金もそこから支払われます
//  （= 利益はすべて宝くじ運営に貯まります）。QUICKONE 同様、取引履歴には残しません。
//
//  ★ 還元率（RTP）≒ 90.2% ／ 当選合計 ≒ 32%
//    1等 7️⃣×3   = 13倍（0.60%）
//    2等 🔔×3   =  5倍（1.17%）   ← 倍率ダウン（旧 8倍）
//    3等 🍒×3   =  4倍（2.03%）
//    4等 🔔が2つ =  3倍（11.97%） ← 倍率アップ（旧 2倍）
//    5等 🍒が2つ =  2倍（16.23%） ← 倍率アップ（旧 1倍）
//    🍋 ははずれ枠。
//  reel … 3つ揃い（1〜3等）と回転シンボル。three は3つ揃いの倍率（0=はずれ枠）。
//  pairs … 「ちょうど2つ揃い」で当たる下位等級（4・5等）。上から優先で判定。
window.BANK_SLOT = {
    cost: 10,
    reel: [
        { key: 'seven',  emoji: '7️⃣', label: '1等',   weight: 4, three: 13 },
        { key: 'bell',   emoji: '🔔', label: '2等',   weight: 5, three: 5  },
        { key: 'cherry', emoji: '🍒', label: '3等',   weight: 6, three: 4  },
        { key: 'lemon',  emoji: '🍋', label: 'はずれ', weight: 7, three: 0  }
    ],
    pairs: [
        { key: 'bell',   label: '4等', mult: 3 }, // 🔔がちょうど2つ
        { key: 'cherry', label: '5等', mult: 2 }  // 🍒がちょうど2つ
    ]
};
