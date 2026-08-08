import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// An AI agent reaches the data through a grant: one account, one client, and
// the profiles the account holder picked on the consent screen. Ownership is
// still checked per query — the grant narrows what a token may ask for, it
// never stands in for who owns a profile.

export const mcpClient = sqliteTable('mcp_client', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	redirectUris: text('redirect_uris', { mode: 'json' }).notNull(),
	uri: text('uri'),
	createdAt: text('created_at').notNull(),
});

export const mcpGrant = sqliteTable('mcp_grant', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	ownerUserId: text('owner_user_id').notNull(),
	clientId: text('client_id')
		.notNull()
		.references(() => mcpClient.id, { onDelete: 'cascade' }),
	/** Profiles this grant may read. */
	patientIds: text('patient_ids', { mode: 'json' }).notNull(),
	/**
	 * Whether assigned gender at birth and age may be returned. Reference ranges
	 * depend on them, and for a trans user they are the fields that out someone
	 * to whichever provider runs the agent, so the choice is the account
	 * holder's and it is made per grant.
	 */
	shareDemographics: integer('share_demographics').notNull().default(0),
	scope: text('scope').notNull(),
	refreshTokenHash: text('refresh_token_hash'),
	/**
	 * The hash the current token replaced. A client presenting it means two
	 * copies of the refresh token exist, which is the signal rotation is for.
	 */
	previousRefreshTokenHash: text('previous_refresh_token_hash'),
	refreshExpiresAt: text('refresh_expires_at'),
	createdAt: text('created_at').notNull(),
	lastUsedAt: text('last_used_at'),
	revokedAt: text('revoked_at'),
}, (table) => [
	index('mcp_grant_owner_idx').on(table.ownerUserId),
	index('mcp_grant_refresh_idx').on(table.refreshTokenHash),
	index('mcp_grant_previous_refresh_idx').on(table.previousRefreshTokenHash),
]);

export const mcpAuthCode = sqliteTable('mcp_auth_code', {
	codeHash: text('code_hash').primaryKey(),
	grantId: text('grant_id')
		.notNull()
		.references(() => mcpGrant.id, { onDelete: 'cascade' }),
	clientId: text('client_id').notNull(),
	redirectUri: text('redirect_uri').notNull(),
	codeChallenge: text('code_challenge').notNull(),
	resource: text('resource'),
	expiresAt: text('expires_at').notNull(),
});
