# @socifyr/mcp

MCP (Model Context Protocol) server that lets AI assistants publish to social media through Socifyr. Powered by [`@socifyr/sdk`](../sdk/README.md) over stdio.

**Supported platforms:** Instagram, Facebook, X (Twitter), LinkedIn, TikTok, YouTube, Threads, Pinterest, Reddit, Bluesky

## Setup

The server is configured entirely via environment variables:

| Variable | Required | Description |
|---|---|---|
| `SOCIFYR_API_KEY` | ✅ | API key (`sk_...`) — create at https://socifyr.com/dashboard/integrations#api-keys |
| `SOCIFYR_API_URL` | — | Custom API URL (self-hosted); defaults to the hosted API |

The API key belongs to one workspace, and the server always works in that workspace. `SOCIFYR_WORKSPACE_ID` is no longer read.

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "socifyr": {
      "command": "npx",
      "args": ["-y", "@socifyr/mcp"],
      "env": {
        "SOCIFYR_API_KEY": "sk_..."
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add socifyr \
  --env SOCIFYR_API_KEY=sk_... \
  -- npx -y @socifyr/mcp
```

### From the monorepo (unpublished)

```bash
cd packages/mcp
pnpm install
pnpm run build
```

Then point your client at `node` with the absolute path, e.g. for Claude Code:

```bash
claude mcp add socifyr \
  --env SOCIFYR_API_KEY=sk_... \
  -- node /path/to/socifyr/packages/mcp/dist/index.js
```

The server speaks newline-delimited JSON-RPC over stdio (initialize → tools/list → tools/call), so it works with any MCP client.

---

## Tools

### `list_connections`

List connected social accounts and their slugs. **Call this first** — posting tools need slugs from here.

> "What accounts can I post to?"

```
Connected accounts (3):

• youtube-black-curtains — youtube / Black Curtains
• tiktok-rebuild-nepali-root — tiktok / rebuild.nepali.root
• instagram-socifyr-post — instagram / socifyr.post (expires 10/28/2026)

Use these slugs in the "connections" field when posting.
```

### `post_text`

Post text immediately.

| Input | Type | Description |
|---|---|---|
| `caption` | string | The text to post |
| `connections` | string[] (≥1) | Connection slugs |
| `firstComment` | string? | Optional first comment (e.g. hashtags) |

> "Post 'Just shipped our new docs 🚀' to my X and LinkedIn, with hashtags as a first comment"

```
Post submitted successfully!
ID: 6b1f0c2a9d3e4f5a6b7c8d9e
Request ID: 9f2c7a1e-3d44-4b2a-8e1f-0a5c2d7e9f10

Check results with: check_post_status tool using ID "6b1f0c2a9d3e4f5a6b7c8d9e"
```

### `schedule_post`

Schedule a text post for later.

| Input | Type | Description |
|---|---|---|
| `caption` | string | The text to post |
| `connections` | string[] (≥1) | Connection slugs |
| `scheduledAt` | string | ISO 8601 datetime, e.g. `"2026-06-15T09:00:00Z"` |
| `firstComment` | string? | Optional first comment |

> "Schedule 'Happy Monday!' for June 15 at 9am UTC on my X account"

```
Post scheduled for 6/15/2026, 9:00:00 AM
ID: 6b1f0c2a9d3e4f5a6b7c8d9e
Connections: x-myhandle
```

### `check_post_status`

Check publishing status by ID (upload ID, draft ID, or requestId).

| Input | Type | Description |
|---|---|---|
| `postId` | string | The ID returned from `post_text`, `schedule_post`, `post_image`, `post_video`, or `publish_draft` |

> "Did my last post go through?"

```
Post 6b1f0c2a9d3e4f5a6b7c8d9e
Status: partial_failure

  ✓ youtube → https://youtube.com/shorts/6zaztTmk3Ck
  ✗ instagram (Requires instagram_content_publish permission)
```

### `post_image`

Post images.

| Input | Type | Description |
|---|---|---|
| `connections` | string[] (≥1) | Connection slugs |
| `images` | string[] (1–10) | Public image URLs **or** media library IDs (24-char hex ObjectIds) |
| `text` | string? | Caption |
| `scheduledAt` | string? | ISO 8601 — omit to post immediately |
| `firstComment` | string? | Optional first comment |
| `contentFormat` | enum? | `photo_single` \| `photo_carousel` \| `story` |

> "Post these two images to Instagram with the caption 'Behind the scenes'"

```
Submitted
ID: 6b1f0c2a9d3e4f5a6b7c8d9e
Images: 2
Connections: instagram-mybrand
```

### `post_video`

Post a video.

| Input | Type | Description |
|---|---|---|
| `connections` | string[] (≥1) | Connection slugs |
| `video` | string | Public video URL **or** media library ID (24-char hex ObjectId) |
| `text` | string? | Caption |
| `scheduledAt` | string? | ISO 8601 — omit to post immediately |
| `firstComment` | string? | Optional first comment |
| `contentFormat` | enum? | `short_video` \| `story` \| `feed_video` |

> "Post this video https://cdn.example.com/teaser.mp4 to TikTok and YouTube as a short"

```
Submitted
ID: 6b1f0c2a9d3e4f5a6b7c8d9e
Connections: tiktok-mybrand, youtube-mybrand
```

### `retry_post`

Retry the failed channels of a partially/fully failed post.

| Input | Type | Description |
|---|---|---|
| `postId` | string | The post ID |

> "Retry the failed channels on that post"

```
Retry queued
ID: 6b1f0c2a9d3e4f5a6b7c8d9e
Retried channels: 1

Check results with: check_post_status tool using ID "6b1f0c2a9d3e4f5a6b7c8d9e"
```

### `publish_draft`

Publish a saved draft immediately.

| Input | Type | Description |
|---|---|---|
| `postId` | string | The draft ID |

> "Publish that draft now"

```
Draft published
ID: 6b1f0c2a9d3e4f5a6b7c8d9e
Request ID: 9f2c7a1e-3d44-4b2a-8e1f-0a5c2d7e9f10

Check results with: check_post_status tool using ID "6b1f0c2a9d3e4f5a6b7c8d9e"
```

### `get_post_analytics`

Per-platform analytics and engagement for one post.

| Input | Type | Description |
|---|---|---|
| `postId` | string | Post ID or requestId |

> "How is my YouTube short performing?"

```
Post analytics: 6b1f0c2a9d3e4f5a6b7c8d9e
Status: completed

  ✓ youtube → https://youtube.com/shorts/6zaztTmk3Ck | likes: 12, comments: 3, impressions: 480
```

### `get_follower_growth`

Follower/subscriber growth per connected account. Counts are captured once a day; LinkedIn and TikTok can't report followers.

| Input | Type | Description |
|---|---|---|
| `period` | enum? | `last_day` \| `last_week` \| `last_month` \| `last_3months` \| `last_year` (default: last 30 days) |
| `connection` | string? | Only this account, by slug |
| `platform` | string? | Only this platform |

> "How many followers did we gain this quarter?"

```
Follower growth 2026-08-12 → 2026-11-12
Total: 5340 followers, +212

  · x-mybrand: 4200 followers, +180 (+4.48%)
  · bluesky-mybrand: 1140 followers, +32 (+2.89%)
  · linkedin-me: follower count not available on linkedin
```

### `compare_accounts`

Side-by-side account comparison for a window: followers and change, posts, engagement, engagement per post, engagement rate and per-follower engagement. Sorted by engagement. Same inputs as `get_follower_growth`.

> "Which of my accounts performed best last month?"

```
Account comparison 2026-10-12 → 2026-11-12

  · x-mybrand [x]: 4200 followers (+180), 12 posts, 424 engagement (35.33/post), 2.02% rate, 0.84% per follower
  · bluesky-mybrand [bluesky]: 1140 followers (+32), 9 posts, 150 engagement (16.67/post), 0% rate, 1.46% per follower
```

### `list_media`

List media library items — the IDs are reusable in `post_image` / `post_video` without re-uploading.

| Input | Type | Description |
|---|---|---|
| `type` | enum? | `image` \| `video` \| `document` |
| `search` | string? | Search by filename |
| `limit` | int? (1–100) | Max results (default 20) |

> "Show me the videos in my media library"

```
Media library (2 total):

• 6a93a4bfaa1135c3d8dd3df5 — launch-teaser.mp4 (video, 8.4MB)
• 6a93b7c2d1e0f3a4b5c6d7e8 — demo-full.mp4 (video, 156.2MB)

Use these IDs in post_image or post_video "images"/"video" fields.
```

### `delete_media`

Delete one or more media items.

| Input | Type | Description |
|---|---|---|
| `ids` | string[] (≥1) | Media IDs to delete |

> "Delete that old teaser video from the media library"

```
Deleted 1 media item: 6a93a4bfaa1135c3d8dd3df5
```

### `generate_caption`

Generate AI captions from a description, URL, or content brief.

| Input | Type | Description |
|---|---|---|
| `description` | string | What to post about, or the raw content to work from |
| `platforms` | string[] (≥1) | Platform **types** for tone optimization, e.g. `["linkedin", "x"]` — required |
| `tone` | enum? | `professional` \| `casual` \| `humorous` \| `inspirational` \| `informative` |

> "Generate a casual caption about our new pricing page for LinkedIn and X"

```
Generated captions:

[linkedin]
...

---

[x]
...
```

---

## Notes

- **Slugs vs platform types**: posting tools take connection **slugs** from `list_connections`; `generate_caption.platforms` takes platform **type** enums (`"linkedin"`, `"x"`, ...) for tone tailoring.
- **Errors** come back as tool results with `isError: true` and the API's message (e.g. `Connection "x" not found`), so the assistant can self-correct.
- The server exits with a clear stderr message if `SOCIFYR_API_KEY` is missing.
