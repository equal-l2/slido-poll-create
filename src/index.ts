import fs from "fs";
import puppeteer from "puppeteer";

type Page = puppeteer.Page;

class FriendlyError extends Error {}

interface PollOption {
    name: string;
    correct?: boolean;
}

interface Poll {
    question: string;
    options: PollOption[];
}

interface Credential {
    email: string;
    pass: string;
}

// ログイン画面の処理
async function login(page: Page, email: string, pass: string): Promise<Page> {
    const slidoLoginPage = "https://accounts.sli.do/login";
    await page.goto(slidoLoginPage, { waitUntil: "domcontentloaded"});
    console.log("Logging in...");

    // 改行文字をフォームに打ち込むとログインボタンを
    // 押した時と同じ動作をする
    await page.type("#emailInput", email + "\n");

    // フォームに入力したメールアドレスがGoogleアカウントと
    // 連携している場合、Googleのログインページに飛ばされる
    // ので、sli.doのログインページと両方対応できるように
    // どちらかのフォームが読み込まれるまで待つ
    await page.waitForSelector("#passwordInput, #identifierNext");

    if (page.url().startsWith(slidoLoginPage)) {
        /* sli.do account */
        console.log("Login with sli.do account");
        await page.type("#passwordInput", pass + "\n");
    } else {
        /* Google account */
        // E-mail address (ページへ移動した時点で入力されている)
        console.log("Login with Google account");
        await page.click("#identifierNext");

        // password
        await page.waitForSelector("input[name=password]", { visible: true });
        await page.type("input[name=password]", pass + "\n");
    }
    await page.waitForNavigation();
    console.log("Login completed successfully");
    return page;
}

// 指定されたイベントのPolls管理画面を開く
// ログイン後イベントリストの画面にいる状態を前提としている
async function openPollsOfEvent(page: Page, name: string): Promise<void> {
    const eventSelector = "div.event-item span"; // イベント名要素のセレクタ
    await page.waitForSelector(eventSelector);
    const es = await page.$$(eventSelector);
    if (es === []) { // イベント名要素が一つもないとき
        throw new FriendlyError("Event not found");
    }

    // 各要素を見てイベント名と合致するか調べる
    let elem = null;
    for (const e of es) {
        const toe = await page.evaluate((e) => {
            return e.innerText;
        }, e);
        if (toe === name) {
            elem = e;
            break;
        }
    }
    if (!elem) { // 合致するイベントがなかったとき
        throw new FriendlyError("Event not found");
    }

    // イベント名要素をクリック
    await page.evaluate((e) => {
        e.click();
    }, elem);
    await page.waitForNavigation({waitUntil: "domcontentloaded"});
    console.log("Opened Event page");

    // Poll管理画面を開く
    await page.goto(page.url().replace("questions", "polls"), {
        waitUntil: "domcontentloaded"
    });
    console.log("Opened Polls page");

    // Polls画面を開いてすぐに新規作成しようとすると
    // 上限を超えていても作成画面に入れてしまうため
    // 2秒待つ
    await page.waitFor(2000);
}

// 新しいPollを作成する
// 対象イベントのPollsにいる状態を前提としている
async function createPoll(page: Page, poll: Poll): Promise<void> {
    // Poll作成ダイアログを開く
    const pollButton = "div.create-component__placeholder";
    await page.waitForSelector(pollButton);
    await page.click(pollButton);
    console.log("Opened Create Poll page");

    // Pollsの種類からMultiple Choicesを選択
    const optionsButton = "li.select-boxed-item[ng-click*=\"('options')\"]";
    await page.waitForSelector(optionsButton, { timeout: 1000 }).catch((e): void => {
        if (e instanceof puppeteer.errors.TimeoutError) {
            throw new FriendlyError("Poll couldn't be created, possibly due to poll limit for free user");
        } else {
            throw e;
        }
    });
    await page.click(optionsButton);
    console.log("Opened Multiple Choice Poll page");

    // "Mark correct answer"をオンにする
    const allowCorrectSelector = "label[ng-model$=allow_correct_answers]";
    await page.click(allowCorrectSelector);

    // 質問文を入力する
    const questionSelector = "textarea[name=questionText0]";
    await page.waitForSelector(questionSelector);
    await page.type(questionSelector, poll.question);

    // 選択肢を入力する
    const ops: PollOption[] = poll.options;
    let hasCorrectAns = false;
    let opcnt = 0;
    for (const op of ops) {
        // 選択肢フォームにテキストを入力
        const textarea = `textarea[name$='${opcnt}_${opcnt}']`;
        await page.waitForSelector(textarea);
        await page.type(textarea, op.name);
        if (op.correct) { // 正解選択肢の場合
            // 正解選択肢ボタンをクリックする
            const eHandle = await page.$(textarea);
            if (!eHandle) {
                throw new Error("Malformed page structure");
            }
            const buttonXPath =
                '../../div[@class="poll-option__controls"]/div[contains(@ng-hide,"allow_correct_answers")]/span/button';
            const cButton = (await eHandle.$x(buttonXPath))[0];
            page.evaluate((b): void => {
                b.click();
            }, cButton);
            hasCorrectAns = true;
        }
        opcnt++;
    }

    if (!hasCorrectAns) { // 正解選択肢がなかった場合
        // "Mark correct answer"をもう一度クリックしてオフにする
        await page.click(allowCorrectSelector);
    }

    // 投稿
    await page.click('button[type="submit"]');
    await page.waitFor(1000); // ページをすぐ閉じると上手く送信されない
    console.log("Poll created");
}

async function run(
    credential: Credential,
    eventName: string,
    polls: Poll[]
): Promise<void> {
    // ブラウザを起動
    const browser = await puppeteer.launch({ headless: true });

    try {
        const page = await browser.newPage(); // 新規ページを開く
        await page.setDefaultTimeout(5000); // タイムアウトを5秒に設定
        await login(page, credential.email, credential.pass); // ログイン
        await openPollsOfEvent(page, eventName); // Pollsを開く
        for (const poll of polls) {
            await createPoll(page, poll); // Pollを作成
        }
    } finally {
        await browser.close(); // ブラウザを閉じる
    }
}

function usage(): void {
    console.log(`Usage: poll-create <event name> <poll>*`);
}

function main(): void {
    // <args> ::= <event name> <poll>*
    const credential = JSON.parse( // credentialを読み取る
        fs.readFileSync("credential.json").toString()
    );
    const ename = process.argv[2]; // イベント名
    const pollFiles = process.argv.slice(3); // Pollのファイル名

    if (!ename) {
        usage();
    } else if (!pollFiles.length) {
        usage();
    } else {
        console.log(`Using ${ename} as event name`);
        const polls = pollFiles.map( // Pollを読み取る
            (s: string): Poll => {
                console.log(`Reading ${s} as a poll definition`);
                const data = fs.readFileSync(s).toString();
                const json = JSON.parse(data);
                return json;
            }
        );
        run(credential, ename, polls);
    }
}

main();
