import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Socifyr, SocifyrError, type UsageDimension } from '@socifyr/sdk'

function errorMessage(err: unknown): string {
  if (err instanceof SocifyrError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Registers every Socifyr tool on an MCP server instance.
 *
 * Shared by both transports: the stdio binary (`index.ts`) and the remote
 * Streamable HTTP endpoint served by the API (`apps/api/src/mcp`). Keep tool
 * definitions here so both surfaces stay identical.
 */
export function registerAllTools(
  server: McpServer,
  client: Socifyr,
) {
  type ToolInputSchema = Record<string, z.ZodTypeAny>
  type ToolHandler = (args: Record<string, any>) => any

  function registerTool(
    name: string,
    description: string,
    inputSchema: ToolInputSchema,
    handler: ToolHandler,
  ) {
    const mcpServer = server as unknown as {
      tool: (
        name: string,
        description: string,
        inputSchema: ToolInputSchema,
        handler: ToolHandler,
      ) => void
    }
    mcpServer.tool(name, description, inputSchema, handler)
  }

  // ── Tool: list_connections ──────────────────────────────────────────────────

  server.tool(
    'list_connections',
    'List all connected social media accounts and their slugs. Call this first to know which slugs to use when posting.',
    {},
    async () => {
      try {
        const connections = await client.workspaces.listConnections()
        const active = connections.filter((c) => !c.disconnectedAt)

        if (active.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No connected social accounts found. Connect accounts at https://socifyr.com/dashboard/integrations',
            }],
          }
        }

        const lines = active.map((c) => {
          const name = c.targetName ?? c.platformUsername
          const expiry = c.expiresAt ? ` (expires ${new Date(c.expiresAt).toLocaleDateString()})` : ''
          const flag =
            c.status === 'needs_reconnect'
              ? ' ⚠ NEEDS RECONNECT — call reconnect_connection'
              : c.status === 'expiring'
                ? c.canRefresh
                  ? ' ⚠ expiring — call refresh_connection'
                  : ' ⚠ expiring soon — call reconnect_connection'
                : ''
          return `• ${c.slug} — ${c.platform} / ${name}${expiry}${flag}`
        })

        return {
          content: [{
            type: 'text',
            text: `Connected accounts (${active.length}):\n\n${lines.join('\n')}\n\nUse these slugs in the "connections" field when posting.`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: post_text ───────────────────────────────────────────────────────────

  registerTool(
    'post_text',
    'Post text content to one or more connected social media accounts immediately.',
    {
      caption: z.string().describe('The text content to post'),
      connections: z.array(z.string()).min(1).describe('Array of connection slugs to post to (e.g. ["twitter-me", "linkedin-company"])'),
      firstComment: z.string().optional().describe('Optional first comment to add after posting (e.g. hashtags)'),
    },
    async ({ caption, connections, firstComment }) => {
      try {
        const upload = await client.uploads.text({
          text: caption,
          connections,
          firstComment: firstComment ? { text: firstComment } : undefined,
        })
        return {
          content: [{
            type: 'text',
            text: `Post submitted successfully!\nID: ${upload.id}\nRequest ID: ${upload.requestId}\n\nCheck results with: check_post_status tool using ID "${upload.id}"`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: schedule_post ─────────────────────────────────────────────────────

  registerTool(
    'schedule_post',
    'Schedule a text post to publish at a specific date and time.',
    {
      caption: z.string().describe('The text content to post'),
      connections: z.array(z.string()).min(1).describe('Array of connection slugs'),
      scheduledAt: z.string().describe('ISO 8601 datetime when to publish (e.g. "2026-06-15T09:00:00Z")'),
      firstComment: z.string().optional().describe('Optional first comment (e.g. hashtags)'),
    },
    async ({ caption, connections, scheduledAt, firstComment }) => {
      try {
        const upload = await client.uploads.text({
          text: caption,
          connections,
          scheduledAt,
          firstComment: firstComment ? { text: firstComment } : undefined,
        })
        const scheduledDate = new Date(scheduledAt).toLocaleString()
        return {
          content: [{
            type: 'text',
            text: `Post scheduled for ${scheduledDate}\nID: ${upload.id}\nConnections: ${connections.join(', ')}`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: schedule_posts (bulk) ─────────────────────────────────────────────

  registerTool(
    'schedule_posts',
    'Schedule MANY text posts in one call (bulk). Each item becomes its own scheduled post. Returns how many were created and any per-item errors. Use this instead of calling schedule_post repeatedly.',
    {
      posts: z
        .array(
          z.object({
            text: z.string().describe('The text content to post'),
            connections: z.array(z.string()).min(1).describe('Connection slugs for this post'),
            scheduledAt: z.string().describe('ISO 8601 datetime to publish this post'),
            title: z.string().optional().describe('Optional title/caption fallback'),
          }),
        )
        .min(1)
        .max(500)
        .describe('The posts to schedule (1-500)'),
    },
    async ({ posts }) => {
      try {
        const res = await client.uploads.bulkSchedule({ rows: posts })
        const errorLines = res.failed.map((f) => `  • Row ${f.row}: ${f.error}`)
        return {
          content: [{
            type: 'text',
            text:
              `Scheduled ${res.created} of ${posts.length} posts.` +
              (res.failed.length ? `\n\n${res.failed.length} failed:\n${errorLines.join('\n')}` : ''),
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: refresh_connection ────────────────────────────────────────────────

  registerTool(
    'refresh_connection',
    "Renew an account's access token without the owner (use when list_connections shows \"expiring\" or a post failed with an expired/invalid token). Works only for accounts that can refresh; if it fails, call reconnect_connection.",
    { connection: z.string().describe('Connection slug, e.g. "instagram-mybrand"') },
    async ({ connection }) => {
      try {
        const r = await client.workspaces.refreshConnection(connection)
        const when = r.expiresAt ? ` New expiry: ${new Date(r.expiresAt).toLocaleString()}.` : ''
        return { content: [{ type: 'text', text: `Refreshed ${r.slug ?? connection} (${r.platform}). Status: ${r.status}.${when}` }] }
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Could not refresh "${connection}": ${errorMessage(err)}\n\nIf it cannot be refreshed, call reconnect_connection to get a re-authorization link.`,
          }],
          isError: true,
        }
      }
    },
  )

  // ── Tool: reconnect_connection ──────────────────────────────────────────────

  registerTool(
    'reconnect_connection',
    'Get a short-lived, single-use link to re-authorize an account whose token expired or cannot refresh (status "needs_reconnect", or a post failed with "reconnect_required"). Give the link to the user to open in a browser; the account and its slug are updated in place, so scheduled posts keep working. After they approve, retry the post. Owner-only.',
    { connection: z.string().describe('Connection slug, e.g. "x-mybrand"') },
    async ({ connection }) => {
      try {
        const link = await client.workspaces.getReconnectLink(connection)
        const minutes = Math.round(link.expiresIn / 60)
        return {
          content: [{
            type: 'text',
            text:
              `Reconnect link for ${link.slug ?? connection} (${link.platform}):\n${link.url}\n\n` +
              `Ask the account owner to open it and approve access with the SAME account (a different account creates a new connection instead). It works once and expires in ${minutes} minutes. ` +
              `Afterwards, retry the failed post (retry_post) or run list_connections to confirm the status is active.`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: check_post_status ─────────────────────────────────────────────────

  registerTool(
    'check_post_status',
    'Check the publishing status of a post by its ID.',
    {
      postId: z.string().describe('The post ID returned from post_text or schedule_post'),
    },
    async ({ postId }) => {
      try {
        const result = await client.uploads.getStatus(postId)
        const channelLines = (result.channels ?? []).map((ch) => {
          const r = ch.result
          const icon = r?.status === 'success' ? '✓' : r?.status === 'failed' ? '✗' : '·'
          const link = r?.postUrl ? ` → ${r.postUrl}` : ''
          const error = r?.error ? ` (${r.error})` : ''
          return `  ${icon} ${ch.platform}${link}${error}`
        })

        return {
          content: [{
            type: 'text',
            text: `Post ${postId}\nStatus: ${result.status}\n\n${channelLines.join('\n') || 'No channel results yet.'}`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: post_image ─────────────────────────────────────────────────────────

  registerTool(
    'post_image',
    'Post one or more images to social platforms. Accepts public image URLs or media library IDs (24-character hex MongoDB ObjectIds).',
    {
      connections: z.array(z.string()).min(1).describe('Connection slugs to post to'),
      images: z.array(z.string()).min(1).max(10).describe('Public image URLs or media library IDs (24-char hex ObjectIds)'),
      text: z.string().optional().describe('Caption text for the post'),
      scheduledAt: z.string().optional().describe('ISO 8601 datetime to schedule (omit to post immediately)'),
      firstComment: z.string().optional().describe('Optional first comment (e.g. hashtags)'),
      contentFormat: z.enum(['photo_single', 'photo_carousel', 'story']).optional().describe('Content format override'),
    },
    async ({ connections, images, text, scheduledAt, firstComment, contentFormat }) => {
      try {
        const upload = await client.uploads.photos({
          connections,
          medias: images,
          text,
          scheduledAt,
          firstComment: firstComment ? { text: firstComment } : undefined,
          ...(contentFormat ? { contentFormat } : {}),
        })
        const action = scheduledAt ? `Scheduled for ${new Date(scheduledAt).toLocaleString()}` : 'Submitted'
        return {
          content: [{
            type: 'text',
            text: `${action}\nID: ${upload.id}\nImages: ${images.length}\nConnections: ${connections.join(', ')}`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: post_video ────────────────────────────────────────────────────────

  registerTool(
    'post_video',
    'Post a video to social platforms. Accepts a public video URL or a media library ID (24-character hex MongoDB ObjectId).',
    {
      connections: z.array(z.string()).min(1).describe('Connection slugs to post to'),
      video: z.string().describe('Public video URL or media library ID (24-char hex ObjectId)'),
      text: z.string().optional().describe('Caption text for the post'),
      scheduledAt: z.string().optional().describe('ISO 8601 datetime to schedule (omit to post immediately)'),
      firstComment: z.string().optional().describe('Optional first comment'),
      contentFormat: z.enum(['short_video', 'story', 'feed_video']).optional().describe('Content format override'),
    },
    async ({ connections, video, text, scheduledAt, firstComment, contentFormat }) => {
      try {
        const upload = await client.uploads.video({
          connections,
          medias: [video],
          text,
          scheduledAt,
          firstComment: firstComment ? { text: firstComment } : undefined,
          ...(contentFormat ? { contentFormat } : {}),
        })
        const action = scheduledAt ? `Scheduled for ${new Date(scheduledAt).toLocaleString()}` : 'Submitted'
        return {
          content: [{
            type: 'text',
            text: `${action}\nID: ${upload.id}\nConnections: ${connections.join(', ')}`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: retry_post ─────────────────────────────────────────────────────────

  registerTool(
    'retry_post',
    'Retry publishing failed channels for a post that partially or fully failed.',
    {
      postId: z.string().describe('The post ID returned from post_text, post_image, or post_video'),
    },
    async ({ postId }) => {
      try {
        const upload = await client.uploads.retry(postId)
        return {
          content: [{
            type: 'text',
            text: `Retry queued\nID: ${upload.id}\nRetried channels: ${upload.retriedChannels ?? 'unknown'}\n\nCheck results with: check_post_status tool using ID "${upload.id}"`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: publish_draft ───────────────────────────────────────────────────────

  registerTool(
    'publish_draft',
    'Publish a saved draft immediately.',
    {
      postId: z.string().describe('The draft post ID to publish'),
    },
    async ({ postId }) => {
      try {
        const upload = await client.uploads.publishDraft(postId)
        // publishDraft's ack is async-only (no uploadId) — keep referencing the
        // draft ID the caller passed; getStatus accepts it.
        return {
          content: [{
            type: 'text',
            text: `Draft published\nID: ${postId}\nRequest ID: ${upload.requestId}\n\nCheck results with: check_post_status tool using ID "${postId}"`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: get_post_analytics ──────────────────────────────────────────────────

  registerTool(
    'get_post_analytics',
    'Get detailed per-platform analytics and engagement metrics for a specific post.',
    {
      postId: z.string().describe('The post ID or requestId to fetch analytics for'),
    },
    async ({ postId }) => {
      try {
        const analytics = await client.analytics.getPost(postId)
        const channelLines = (analytics.platforms ?? []).map((ch) => {
          const icon = ch.status === 'success' ? '✓' : ch.status === 'failed' ? '✗' : '·'
          const link = ch.postUrl ? ` → ${ch.postUrl}` : ''
          const eng = ch.engagement
            ? ` | likes: ${ch.engagement.likes}, comments: ${ch.engagement.comments}, impressions: ${ch.engagement.impressions}`
            : ''
          return `  ${icon} ${ch.platform}${link}${eng}`
        })

        return {
          content: [{
            type: 'text',
            text: `Post analytics: ${postId}\nStatus: ${analytics.status}\n\n${channelLines.join('\n') || 'No channel data yet.'}`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tools: follower growth + account comparison (#15) ────────────────────────

  const accountAnalyticsSchema = {
    period: z
      .enum(['last_day', 'last_week', 'last_month', 'last_3months', 'last_year'])
      .optional()
      .describe('Time window (default: last 30 days)'),
    connection: z.string().optional().describe('Only this account, by connection slug (e.g. "instagram-mybrand")'),
    platform: z.string().optional().describe('Only accounts on this platform (e.g. "x")'),
  }

  const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

  registerTool(
    'get_follower_growth',
    'Follower/subscriber growth per connected account over a time window: current count, change and percent change. ' +
      'Counts are captured once a day; LinkedIn and TikTok accounts cannot report followers.',
    accountAnalyticsSchema,
    async (query) => {
      try {
        const growth = await client.analytics.followers(query)
        const lines = growth.accounts.map((a) => {
          const name = a.slug ?? a.username
          if (!a.isTracked) return `  · ${name}: follower count not available on ${a.platform}`
          if (a.followers === null) return `  · ${name}: first daily snapshot pending`
          const pct = a.changePct === null ? '' : ` (${a.changePct > 0 ? '+' : ''}${a.changePct}%)`
          return `  · ${name}: ${a.followers} followers, ${signed(a.change)}${pct}`
        })
        return {
          content: [{
            type: 'text',
            text:
              `Follower growth ${growth.from.slice(0, 10)} → ${growth.to.slice(0, 10)}\n` +
              `Total: ${growth.totals.followers} followers, ${signed(growth.totals.change)}\n\n` +
              (lines.join('\n') || 'No connected accounts match.'),
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  registerTool(
    'compare_accounts',
    'Compare connected accounts side by side for a time window: followers and follower change, posts published, ' +
      'total engagement (likes + comments + shares + saves), average engagement per post, engagement rate ' +
      '(engagement ÷ impressions) and follower engagement rate (avg engagement per post ÷ followers). Sorted by engagement.',
    accountAnalyticsSchema,
    async (query) => {
      try {
        const comparison = await client.analytics.accounts(query)
        const lines = comparison.accounts.map((a) => {
          const followers =
            a.followers === null ? 'followers n/a' : `${a.followers} followers (${signed(a.followerChange)})`
          const followerRate = a.followerEngagementRate === null ? '' : `, ${a.followerEngagementRate}% per follower`
          return (
            `  · ${a.slug ?? a.username} [${a.platform}]: ${followers}, ${a.posts} posts, ` +
            `${a.engagement} engagement (${a.avgEngagementPerPost}/post), ${a.engagementRate}% rate${followerRate}`
          )
        })
        return {
          content: [{
            type: 'text',
            text:
              `Account comparison ${comparison.from.slice(0, 10)} → ${comparison.to.slice(0, 10)}\n\n` +
              (lines.join('\n') || 'No connected accounts match.'),
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: get_usage ───────────────────────────────────────────────────────────

  registerTool(
    'get_usage',
    "Show the workspace's current usage against its plan limits: posts this month, connected accounts, and storage. Check this before connecting accounts or posting to see remaining quota.",
    {},
    async () => {
      try {
        const u = await client.workspaces.usage()
        const fmtGb = (b: number) =>
          b >= 1_073_741_824
            ? `${(b / 1_073_741_824).toFixed(1)}GB`
            : `${Math.round(b / 1_048_576)}MB`
        const line = (
          label: string,
          d: UsageDimension,
          fmt: (n: number) => string = (n) => String(n),
        ) =>
          d.unlimited
            ? `${label}: ${fmt(d.used)} / unlimited`
            : `${label}: ${fmt(d.used)} / ${fmt(d.limit ?? 0)} (${fmt(d.remaining ?? 0)} left)`

        const lines = [
          line('Posts this month', u.uploads),
          line('X posts this month', u.xPosts) + ` (~$${u.xSpendUsd.toFixed(2)} X spend)`,
          ...(u.scheduledPosts ? [line('Scheduled posts this month', u.scheduledPosts)] : []),
          line('Connected accounts', u.accounts),
          line('Storage', u.storage, fmtGb),
        ]
        return {
          content: [{ type: 'text', text: `Usage (${u.tier} plan):\n\n${lines.join('\n')}` }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: list_media ──────────────────────────────────────────────────────────

  registerTool(
    'list_media',
    'List files in the media library. Returns IDs you can reuse in post_image or post_video without re-uploading.',
    {
      type: z.enum(['image', 'video', 'document']).optional().describe('Filter by media type'),
      search: z.string().optional().describe('Search by filename'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 20)'),
    },
    async ({ type, search, limit }) => {
      try {
        const result = await client.media.list({ type, search, limit })
        const items: any[] = (result as any).results ?? (result as any).data ?? []
        const total = (result as any).total ?? items.length

        if (items.length === 0) {
          return { content: [{ type: 'text', text: 'No media found in library.' }] }
        }

        const lines = items.map((m: any) => {
          const bytes = m.sizeBytes ?? m.size ?? 0
          const size = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`
          return `• ${m.id} — ${m.name ?? m.filename} (${m.type}, ${size})`
        })

        return {
          content: [{
            type: 'text',
            text: `Media library (${total} total):\n\n${lines.join('\n')}\n\nUse these IDs in post_image or post_video "images"/"video" fields.`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: delete_media ────────────────────────────────────────────────────────

  registerTool(
    'delete_media',
    'Delete one or more items from the media library by their IDs.',
    {
      ids: z.array(z.string()).min(1).describe('One or more media IDs to delete'),
    },
    async ({ ids }) => {
      try {
        if (ids.length === 1) {
          await client.media.delete(ids[0])
        } else {
          await client.media.bulkDelete(ids)
        }
        return {
          content: [{
            type: 'text',
            text: `Deleted ${ids.length} media item${ids.length === 1 ? '' : 's'}: ${ids.join(', ')}`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: generate_caption ────────────────────────────────────────────────────

  registerTool(
    'generate_caption',
    'Use AI to generate social media captions from a description, URL, or content brief.',
    {
      description: z.string().describe('Description of what you want to post about, or the raw content to summarize'),
      platforms: z.array(z.string()).min(1).describe('Target platform types for tone optimization (e.g. ["linkedin", "x"]) — required, at least one'),
      tone: z.enum(['professional', 'casual', 'humorous', 'inspirational', 'informative']).optional().describe('Writing tone'),
    },
    async ({ description, platforms, tone }) => {
      try {
        const result = await client.ai.generateContent({
          uploadType: 'text',
          platforms: platforms as any,
          description,
          tone: tone as any,
        })

        const entries = Object.entries(result.content ?? {})
        if (entries.length === 0) {
          return { content: [{ type: 'text', text: 'No captions generated.' }] }
        }

        const lines = entries.map(([platform, text]) => `[${platform}]\n${text}`)

        return {
          content: [{
            type: 'text',
            text: `Generated captions:\n\n${lines.join('\n\n---\n\n')}`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: list_posts ──────────────────────────────────────────────────────────

  registerTool(
    'list_posts',
    'List your posts (drafts, scheduled, and published) with their IDs — use this to find a post to edit, publish, or check. Returns each post\'s ID, status, type, a text preview, schedule time, and target accounts.',
    {
      status: z
        .enum(['draft', 'scheduled', 'queued', 'publishing', 'completed', 'partial_failure', 'failed'])
        .optional()
        .describe('Filter by status. Use "scheduled" for posts queued to publish at a future time.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
    },
    async ({ status, limit }) => {
      try {
        // "scheduled" is a friendly alias — scheduled posts are stored as "pending".
        const query: Record<string, unknown> = { limit: limit ?? 20 }
        if (status) query.status = status === 'scheduled' ? 'pending' : status

        const result = await client.uploads.list(query)
        const items = result.data ?? []
        if (items.length === 0) {
          return { content: [{ type: 'text', text: 'No posts found.' }] }
        }

        const lines = items.map((p: any) => {
          const when = p.scheduledAt
            ? ` | scheduled ${new Date(p.scheduledAt).toLocaleString()}`
            : ''
          const accounts = (p.channels ?? [])
            .map((c: any) => (c.targetName ? `${c.platform}/${c.targetName}` : c.platform))
            .join(', ')
          const preview = String(p.title || p.text || '').slice(0, 60)
          return `• ${p.id} — [${p.status}] ${p.type}${preview ? ` "${preview}"` : ''}${when}${accounts ? `\n    → ${accounts}` : ''}`
        })

        const total = result.meta?.total ?? items.length
        return {
          content: [{
            type: 'text',
            text: `Posts (${total} total):\n\n${lines.join('\n')}\n\nUse a post ID with update_post, publish_draft, check_post_status, or get_post_analytics.`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )

  // ── Tool: update_post ───────────────────────────────────────────────────────

  registerTool(
    'update_post',
    'Edit an existing draft or scheduled post — change its text, media, schedule, or which accounts it posts to. Only drafts and not-yet-published scheduled posts can be edited. IMPORTANT: "connections" is a FULL REPLACEMENT of the target accounts, not a delta — to add or remove one account, pass the complete desired set of slugs (use list_posts / list_connections first to see the current ones).',
    {
      postId: z.string().describe('The draft or scheduled post ID (from list_posts)'),
      connections: z.array(z.string()).min(1).optional().describe('FULL set of connection slugs the post should go to (replaces the current set)'),
      text: z.string().optional().describe('New caption/body text'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      firstComment: z.string().optional().describe('First comment text (e.g. hashtags)'),
      mediaIds: z.array(z.string()).optional().describe('Media library IDs to attach (replaces current media)'),
      scheduledAt: z.string().optional().describe('New ISO 8601 schedule time. For a scheduled post this must be in the future.'),
      contentFormat: z.string().optional().describe('Content format override'),
    },
    async ({ postId, connections, text, title, description, firstComment, mediaIds, scheduledAt, contentFormat }) => {
      try {
        const hasChange =
          connections !== undefined ||
          text !== undefined ||
          title !== undefined ||
          description !== undefined ||
          firstComment !== undefined ||
          mediaIds !== undefined ||
          scheduledAt !== undefined ||
          contentFormat !== undefined
        if (!hasChange) {
          return {
            content: [{ type: 'text', text: 'Nothing to update — provide at least one field (connections, text, scheduledAt, …).' }],
            isError: true,
          }
        }

        await client.uploads.update(postId, {
          ...(connections ? { connections } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(firstComment !== undefined ? { firstComment: { text: firstComment } } : {}),
          ...(mediaIds ? { mediaIds } : {}),
          ...(scheduledAt !== undefined ? { scheduledAt } : {}),
          ...(contentFormat !== undefined ? { contentFormat } : {}),
        })

        const parts = [`Post ${postId} updated.`]
        if (connections) parts.push(`Connections now: ${connections.join(', ')}`)
        if (scheduledAt) parts.push(`Scheduled for: ${new Date(scheduledAt).toLocaleString()}`)
        parts.push(`Check it with: check_post_status tool using ID "${postId}"`)

        return { content: [{ type: 'text', text: parts.join('\n') }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${errorMessage(err)}` }], isError: true }
      }
    },
  )
}
