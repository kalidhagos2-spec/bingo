# USA Bingo — Telegram channel kit

Everything needed to open the official channel and run it for the first two weeks.
Bot: **@Usabingo_bot**. Every fact in the posts below is true of the game as it runs today
(10 / 20 / 50 ETB tables, up to 4 cartelas out of 400, prizes up to 3,000 ETB, win on a row,
column, diagonal or four corners, Telebirr deposits checked by transaction number, no deposit
fee, 2 % cash-out fee, 50 ETB minimum cash-out, Amharic call-outs, AUTO marking, wallet
transfers by phone number). If you change a rule, change the post.

> The Amharic was written for this kit, not by a native copywriter. Have one person who
> speaks it daily read each post once before it goes out.

## 1. What the competitors do (from their public channels, 18 Sep 2026)

| | ATS Bingo (`@atsbingo`, `@atsbingo_bot`) | Beteseb Bingo (`@betesebbingo`, `@betesebbingo_bot`) |
|---|---|---|
| Size | 150–1,000 views per post | 42,329 monthly bot users, 27K–69K views per post |
| Rhythm | 2–3 posts every day: afternoon, evening, night | Few posts, each pinned-quality and kept for months |
| Voice | All Amharic, a nickname for every weekday ("Golden Saturday", "Crazy Monday") | All Amharic, short, one image |
| Hook | Holiday **Top-10 bonus race** (20,000 ETB), winners' names and amounts published | — |
| Trust | "Fast and reliable payout" in every post | "Licensed gaming platform", "Play responsibly 21+", a **scam warning** naming the only real username |
| Help | `/contact`, `/depositinstructions`, `/withdrawinstructions`, `/instructions`, a support account | Support account, deposit how-to post (transaction number only) |
| Growth | A channel-verify bot: you must join the channel before you can play | Same three-line footer under every post: play · support · channel |

## 2. Open the channel (10 minutes, from your own Telegram account)

1. Telegram → New Channel → name **USA Bingo 🇺🇸** → Public → link `t.me/usabingo_official`
   (try `usabingo`, `usa_bingo`, `usabingo_et` if taken). Use the USA Bingo logo as the photo.
2. Description:
   `የ USA ቢንጎ ይፋዊ ቻናል 🎱 ለመጫወት 👉 @Usabingo_bot · ድጋፍ 👉 @usabingo_support · 21+ በኃላፊነት ይጫወቱ`
3. Create a second account or group **@usabingo_support** for questions. Never answer money
   questions from a personal account: players must learn one name.
4. Add **@Usabingo_bot** to the channel as an administrator with "Post messages" and "Edit
   messages of others" (Telegram needs the second one to pin). That is what lets step 7 publish
   the launch posts, and the server post winners by itself later (section 5).
5. The bot's own page is already done: at every start the bot sets its "/" command menu, its
   description (the text in the empty chat) and its about text, in Amharic, from `BOT_PROFILE`
   in `bot/src/i18n.js`. Edit the text there, or set `BOT_APPLY_PROFILE=false` in `bot/.env` to
   type your own into @BotFather. Only the **photo** is manual: @BotFather → `/setuserpic`.
6. Put the two usernames in `bot/.env` (`CHANNEL_USERNAME=`, `SUPPORT_USERNAME=`) and restart
   the bot: `/contact` starts showing them.
7. Publish the launch posts with the footer, and pin the welcome post, in one go:
   `cd bot && node scripts/channel-posts.mjs` prints exactly what will be posted;
   add `--send` to publish (`--send --only 5` re-posts just the scam warning).

**Footer under every post** (copy exactly, always the same three lines):

```
🎱 ለመጫወት: @Usabingo_bot
❓ ለጥያቄ: @usabingo_support
📣 ቻናል: @usabingo_official
USA ቢንጎ — ይጫወቱ · ያሸንፉ · በቴሌብር ያውጡ 🇺🇸   21+ በኃላፊነት ይጫወቱ
```

## 3. Launch posts

### Post 1 — welcome (pin this)

```
🇺🇸🎱 እንኳን ወደ USA ቢንጎ በደህና መጡ!

ቴሌግራም ሳይለቁ፣ ከስልክዎ ላይ፣ ከእውነተኛ ተጫዋቾች ጋር ቀጥታ ቢንጎ።

💵 10፣ 20 እና 50 ብር ጠረጴዛዎች — እንደ አቅምዎ ይምረጡ
🎟 በአንድ ዙር እስከ 4 ካርቴላ፣ ከ400 ካርቴላዎች መካከል
🏆 በአንድ ዙር እስከ 3,000 ብር ሽልማት
🗣 ቁጥሮች በአማርኛ ድምፅ ይጠራሉ
⚡️ AUTO ሲበራ ቁጥሮችዎ በራሳቸው ይመታሉ — አንድም አያመልጥዎትም
📲 በቴሌብር ያስገቡ፣ በቴሌብር ያውጡ

👇 አሁኑኑ ይጀምሩ
@Usabingo_bot → START → «ቢንጎ ይጫወቱ»
```
*English: Welcome to USA Bingo. Live bingo with real players without leaving Telegram. 10/20/50
ETB tables, up to 4 cartelas of 400, up to 3,000 ETB a round, numbers called in Amharic, AUTO
marks for you, Telebirr in and out. Start: @Usabingo_bot.*

### Post 2 — how to deposit

```
💳 ዋሌት እንዴት ይሞላል? 3 ደረጃ ብቻ

1️⃣ በጨዋታው ውስጥ «ዋሌት» → «ያስገቡ» ይክፈቱ፤ የቴሌብር ቁጥራችንን ኮፒ ያድርጉ
2️⃣ በቴሌብር ገንዘቡን ይላኩ
3️⃣ ከቴሌብር መልእክቱ ላይ ያለውን Transaction No ብቻ (ለምሳሌ DEI559JRN) ያስገቡ

✅ ሙሉ መልእክት መላክ አያስፈልግም — ቁጥሩ ብቻ በቂ ነው
✅ ስርዓታችን ደረሰኙን በራሱ ያረጋግጣል
✅ ለማስገባት ምንም ክፍያ የለም (0%)

⚠️ ገንዘብ የሚላከው በቦቱ ውስጥ ወደሚታየው ቁጥር ብቻ ነው። በግል መልእክት ቁጥር የሚልክልዎ ሰው የእኛ አይደለም።
```
*English: Top up in 3 steps: copy our Telebirr number in Wallet → Deposit, send the money, enter
only the Transaction No. The system checks the receipt itself. No deposit fee. Only ever pay
the number shown inside the bot.*

### Post 3 — how to cash out

```
💸 ያሸነፉትን እንዴት ያወጣሉ?

1️⃣ «ዋሌት» → «ያውጡ»
2️⃣ መጠኑን እና የቴሌብር ቁጥርዎን ያስገቡ
3️⃣ ጥያቄዎ ከተረጋገጠ በኋላ ገንዘቡ ወደ ቴሌብርዎ ይላካል

• ዝቅተኛ ማውጫ: 50 ብር
• የአገልግሎት ክፍያ: 2% ብቻ
• ለጓደኛ መላክ ይፈልጋሉ? «ላክ» → ስልክ ቁጥሩን ያስገቡ — ወዲያውኑ ይደርሳል
```
*English: Cash out from Wallet → Cash out with your Telebirr number; it is sent once the request is
confirmed. Minimum 50 ETB, 2 % fee.
"Send" moves money to a friend's wallet by phone number at once.*

### Post 4 — rules

```
📜 የጨዋታ ሕግ በአጭሩ

1. ጠረጴዛ ይምረጡ (10 / 20 / 50 ብር) እና ካርቴላዎን ይምረጡ — እስከ 4
2. ቆጠራው ሲያልቅ ጨዋታው ይጀምራል፤ ቁጥሮች አንድ በአንድ ይጠራሉ
3. የተጠራ ቁጥር ካርቴላዎ ላይ ካለ ይንኩት (ወይም AUTO ያብሩ)
4. አንድ ሙሉ መስመር ➖ ወደ ጎን፣ ወደ ታች ⬇️፣ ሰያፍ ↘️ ወይም 4ቱ ማዕዘኖች 🔲 ሲሞሉ «ቢንጎ!» ይጫኑ
5. መጀመሪያ «ቢንጎ!» ያለ ትክክለኛ ተጫዋች ሽልማቱን ይወስዳል 🏆

ማንም ካላሸነፈ የሁሉም ተጫዋች ብር ይመለሳል።
```

### Post 5 — scam warning (repost monthly)

```
⚠️ ማሳሰቢያ ለ USA ቢንጎ ቤተሰቦች

«USA ቢንጎ ነን» እያሉ በግል መልእክት ገንዘብ የሚጠይቁ አጭበርባሪዎች ሊኖሩ ይችላሉ።

✅ ትክክለኛው ቦት: @Usabingo_bot ብቻ
✅ ትክክለኛው ድጋፍ: @usabingo_support ብቻ
🚫 እኛ በግል መልእክት ገንዘብ፣ ፒን ወይም የይለፍ ቃል በፍጹም አንጠይቅም
```

## 4. Daily rhythm (two posts a day is enough to start)

Post at **13:00** and **20:30** (Addis time): lunch break and the evening peak. Give each day its
own name so regulars recognise it, as ATS does, but with your own names:

| Day | Name | Angle |
|---|---|---|
| Mon | 🚀 ሰኞ መነሻ (Monday Kick-off) | Start the week: the 10 ETB table is filling |
| Tue | 🎟 ባለ 4 ካርቴላ ማክሰኞ (4-Cartela Tuesday) | Teach: more cartelas, more lines to win on |
| Wed | 🗣 የአማርኛ ድምፅ ረቡዕ (Amharic Caller Wednesday) | Our difference: numbers called in Amharic |
| Thu | 🤝 የጓደኛ ሐሙስ (Friends Thursday) | "Send" money to a friend, play the same table |
| Fri | 🔥 የ50 ብር አርብ (Fifty Friday) | The 50 ETB table, prizes up to 3,000 |
| Sat | ⭐️ ኮከብ ቅዳሜ (Star Saturday) | Weekly Top-10 closes tonight |
| Sun | 🏆 የአሸናፊዎች እሁድ (Winners Sunday) | Publish the week's winners and totals |

### Afternoon template

```
{የቀኑ ስም}

የ{10/20/50} ብር ጠረጴዛ አሁን እየሞላ ነው — {N} ተጫዋቾች ገብተዋል 👀
ካርቴላዎን ይምረጡ፣ ቆጠራው ከማለቁ በፊት ይግቡ!

⚡️ ቀላል ጨዋታ   🗣 በአማርኛ ጥሪ   📲 በቴሌብር ክፍያ
```

### Evening template (always a real result from today)

```
🏆 የዛሬ አሸናፊዎች

🥇 {ስም} — {መጠን} ብር ({ጠረጴዛ} ብር ጠረጴዛ፣ በ{N}ኛው ጥሪ)
🥈 {ስም} — {መጠን} ብር
🥉 {ስም} — {መጠን} ብር

ዛሬ በድምሩ {ጠቅላላ} ብር ተከፍሏል 💸 ቀጣዩ እርስዎ ይሁኑ!
```
Take the names and amounts from **Admin → Games**. Use first names or the display name only,
and never post a winner the dashboard tags **DEMO**: those are house players, and a fake winner
in public is the fastest way to lose the trust this channel exists to build.

### Weekly Top-10 (the competitors' strongest hook)

```
⭐️ የሳምንቱ ምርጥ 10 ውድድር

ከሰኞ እስከ ቅዳሜ ምሽት 3:00 ብዙ ዙር ያሸነፉ 10 ተጫዋቾች ቦነስ ይሸለማሉ፡

🥇 1ኛ — {…} ብር   🥈 2ኛ — {…} ብር   🥉 3ኛ — {…} ብር
4ኛ–10ኛ — እያንዳንዳቸው {…} ብር

ደረጃዎን በጨዋታው ውስጥ «ምርጥ ተጫዋቾች» ላይ ይከታተሉ። ውጤቱ እሁድ እዚህ ቻናል ላይ ይለጠፋል።
```
Decide the amounts from what the house actually earned that week (Admin → House); ATS ran
20,000 ETB for a holiday, which is a holiday budget, not a weekly one.

## 5. What to build next, in order of players gained per day of work

Found by comparing the two bots and channels above with @Usabingo_bot and its server.

1. **Amharic in the bot and the Mini App.** Both competitors speak only Amharic; ours speaks only
   English apart from the caller's voice. A language switch (አማርኛ default) is the largest gap.
2. **A server that is always on.** They are up day and night; ours sleeps with a laptop and drops
   with home internet (the ERR_NGROK_3200 players saw). Nothing else matters while this is true.
3. **Help commands in the bot**: `/deposit`, `/withdraw`, `/rules`, `/contact`, `/balance`, in
   Amharic, plus the support account. ATS has all four; we have `/start`, `/play`, `/profile`.
4. **Winners posted to the channel automatically** (bot is channel admin): real social proof every
   few minutes without anyone typing, skipping DEMO winners.
5. **Weekly Top-10 bonus race** paid by the server on Saturday night, with a countdown in the
   lobby. The leaderboard already exists; the race and the payout do not.
6. **Invite a friend**: a personal `t.me/Usabingo_bot?start=ref_…` link, a bonus for both once
   the friend's first deposit is approved. Neither competitor shows this publicly; it is the
   cheapest growth there is and their channel-gate is a cruder version of it.
7. **Join-the-channel gate or reward**: ATS requires channel membership before play. Kinder and
   as effective: a one-time 5 ETB bonus for joining, checked with `getChatMember`.
8. **Welcome bonus** on the first approved deposit (say +10 %), shown on the lobby's DEPOSIT button.
9. **21+ and responsible-play notice, terms, and a licence line.** Beteseb advertises "Licensed
   gaming platform · Play responsibly 21+". An age confirmation at sign-up and a terms page are a
   day's work. The licence itself is not code: games of chance for money in Ethiopia are licensed
   by the National Lottery Administration, and operating or advertising without one is the largest
   risk to this business. Do not write "licensed" in any post until it is true.
10. **Bot profile**: description, about text and photo in BotFather (step 5 above); today the bot's
    page is empty where ATS says "#1 bingo in Ethiopia" and Beteseb shows 42K monthly users.
