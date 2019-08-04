import fs from "fs";
import puppeteer from "puppeteer";

type Page = puppeteer.Page;

class FriendlyError extends Error {}

interface PollOption {
    name: string;
    correct?: boolean;
}

interface Poll {
    desc: string;
    options: PollOption[];
}

interface Credential {
    email: string;
    pass: string;
}

async function login(page: Page, email: string, pass: string): Promise<Page> {
    const slidoLoginPage = "https://accounts.sli.do/login";
    await page.goto(slidoLoginPage, { waitUntil: "domcontentloaded"});
    console.log("Logging in...");
    await page.type("#emailInput", email + "\n");
    await page.waitForSelector("#passwordInput, #identifierNext");
    if (page.url().startsWith(slidoLoginPage)) {
        /* sli.do account */
        console.log("Login with sli.do account");
        await page.type("#passwordInput", pass + "\n");
    } else {
        /* Google account */
        // E-mail address (should be filled already)
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

async function openNewPollOfEvent(page: Page, name: string): Promise<void> {
    // イベントの管理画面を開く
    const eventSelector = "div.event-item span";
    await page.waitForSelector(eventSelector);
    const es = await page.$$(eventSelector);
    if (es === []) {
        throw new FriendlyError("Event not found");
    }
    let elem = null;
    for (const e of es) {
        const toe = await page.evaluate((e): string => {
            return e.innerText;
        }, e);
        if (toe === name) {
            elem = e;
            break;
        }
    }
    if (!elem) {
        throw new FriendlyError("Event not found");
    }
    await page.evaluate((e): void => {
        e.click();
    }, elem);
    await page.waitForNavigation({waitUntil: "domcontentloaded"});
    console.log("Opened Event page");

    // Poll管理画面を開く
    await page.goto(page.url().replace("questions", "polls"), {
        waitUntil: "domcontentloaded"
    });
    console.log("Opened Polls page");
    await page.waitFor(2000); // 急ぎすぎるとPoll個数の上限を超えていても設定画面に入れてしまう
}

async function createPoll(page: Page, poll: Poll): Promise<void> {
    // Poll作成ダイアログを開く
    const pollButton = "div.create-component__placeholder";
    await page.waitForSelector(pollButton);
    await page.click(pollButton);
    console.log("Opened Create Poll page");

    // Multiple Choicesを選択
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

    const allowCorrectSelector = "label[ng-model$=allow_correct_answers]";
    await page.click(allowCorrectSelector);

    const descSelector = "textarea[name=questionText0]";
    await page.waitForSelector(descSelector);
    await page.type(descSelector, poll.desc);

    const ops: PollOption[] = poll.options;
    let hasCorrectAns = false;
    let opcnt = 0;
    for (const op of ops) {
        const textarea = `textarea[name$='${opcnt}_${opcnt}']`;
        await page.waitForSelector(textarea);
        await page.type(textarea, op.name);
        if (op.correct) {
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
    if (!hasCorrectAns) {
        await page.click(allowCorrectSelector);
    }
    await page.click('button[type="submit"]');
    await page.waitFor(1000); // ページをすぐ閉じると上手く送信されない感じ
    console.log("Poll created");
}

async function run(
    credential: Credential,
    eventName: string,
    polls: Poll[]
): Promise<void> {
    const browser = await puppeteer.launch({ headless: false });

    try {
        const page = await browser.newPage();
        await page.setDefaultTimeout(5000);
        await login(page, credential.email, credential.pass);
        await openNewPollOfEvent(page, eventName);
        for (const poll of polls) {
            await createPoll(page, poll);
        }
    } catch (e) {
        //
    } finally {
        await browser.close();
    }
}

function usage(): void {
    console.log(`Usage: poll-create <event name> <poll>*`);
}

function main(): void {
    // <args> ::= <event name> <poll>*
    const credential = JSON.parse(
        fs.readFileSync("credential.json").toString()
    );
    const ename = process.argv[2];
    const pollFiles = process.argv.slice(3);

    if (!ename) {
        usage();
    } else if (!pollFiles.length) {
        usage();
    } else {
        console.log(`Using ${ename} as event name`);
        const polls = pollFiles.map(
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
