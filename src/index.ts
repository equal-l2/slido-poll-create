import fs from "fs";
import puppeteer from "puppeteer";

type Page = puppeteer.Page;

interface PollOption {
    name: string;
    correct?: boolean;
}

interface Poll {
    desc: string;
    options: Array<PollOption>;
}

interface Credential {
    email: string;
    pass: string;
}

async function login(page: Page, email: string, pass: string): Promise<Page> {
    const slidoLoginPage = "https://accounts.sli.do/login";
    await page.goto(slidoLoginPage, { waitUntil: "domcontentloaded" });
    await page.type("#emailInput", email + "\n");
    await page.waitForNavigation({ waitUntil: "networkidle0" });

    if (page.url().startsWith(slidoLoginPage)) {
        /* sli.do account */
        console.log("Login with sli.do account");
        await page.waitForSelector("#passwordInput");
        await page.type("#passwordInput", pass + "\n");
    } else {
        /* Google account */
        // E-mail address (should be filled already)
        console.log("Login with Google account");
        await page.waitForSelector("#identifierNext");
        await page.click("#identifierNext");

        // password
        await page.waitForSelector("input[name=password]", { visible: true });
        await page.type("input[name=password]", pass + "\n");
    }
    await page.waitForNavigation();
    console.log("Login completed successfully");

    return page;
}

async function clickByText(page: Page, selector: string, text: string) {
    await page.waitForSelector(selector);
    const es = await page.$$(selector);
    if (es === []) throw "Element not found";

    let elem;
    for (const e of es) {
        const toe = await page.evaluate((e) => e.innerText, e);
        if (toe === text) {
            elem = e;
            break;
        }
    }
    if (!elem) throw "Element not found";
    await page.evaluate((e) => {
        e.click();
    }, elem);
}

async function openNewPollOfEvent(page: Page, name: string) {
    await clickByText(page, "div.event-item span", name);
    await page.waitForNavigation();
    console.log("Opened Event page");
    await page.goto(page.url().replace("questions", "polls"), {
        waitUntil: "domcontentloaded"
    });
    console.log("Opened Polls page");
    const pollButton = "div.create-component__placeholder";
    await page.waitForSelector(pollButton);
    await page.click(pollButton);
    console.log("Opened Create Poll page");
    const optionsButton = "li.select-boxed-item[ng-click*=\"('options')\"]";
    await page.waitForSelector(optionsButton, { timeout: 1000 });
    await page.click(optionsButton);
}

async function createPoll(page: Page, poll: Poll) {
    let hasCorrectAns = false;
    let opcnt = 0;
    const desc = poll.desc;
    const ops: Array<PollOption> = poll.options;
    const descSelector = "textarea[name=questionText0]";
    const allowCorrectSelector = "label[ng-model$=allow_correct_answers]";
    await page.waitForSelector(descSelector);
    await page.type("textarea[name=questionText0]", desc);
    await page.click(allowCorrectSelector);

    for (const op of ops) {
        const textarea = `textarea[name$='${opcnt}_${opcnt}']`;
        await page.waitForSelector(textarea);
        page.type(textarea, op.name);
        if (op.correct) {
            let eHandle = await page.$(textarea);
            if (!eHandle) {
                throw "Malformed page structure";
            }
            const buttonXPath =
                '../../div[@class="poll-option__controls"]/div[contains(@ng-hide,"allow_correct_answers")]/span/button';
            let cButton = (await eHandle.$x(buttonXPath))[0];
            page.evaluate((b) => {
                b.click();
            }, cButton);
            hasCorrectAns = true;
        }
        opcnt++;
    }
    if (!hasCorrectAns) {
        await page.click(allowCorrectSelector);
    }
    await page.click('button[type="submit"');
}

async function run(
    credential: Credential,
    eventName: string,
    polls: Array<Poll>
) {
    let browser = await puppeteer.launch({ headless: false });

    try {
        let page = await browser.newPage();
        await login(page, credential.email, credential.pass);
        await openNewPollOfEvent(page, eventName);
        for (const poll of polls) {
            await createPoll(page, poll);
        }
    } finally {
        browser.close();
    }
}

function main() {
    // <args> ::= <event name> <poll>*
    const credential = JSON.parse(
        fs.readFileSync("credential.json").toString()
    );
    const ename = process.argv[2];
    const polls: Array<Poll> = process.argv.slice(3).map((s) => {
        console.log("Reading " + s + " as a poll definition");
        const data = fs.readFileSync(s).toString();
        const json = JSON.parse(data);
        return json;
    });

    if (!ename) {
        throw "Event name is missing";
    }

    if (!polls.length) {
        throw "Polls are missing";
    }

    run(credential, ename, polls);
}

main();
