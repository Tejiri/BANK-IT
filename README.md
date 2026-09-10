# Bankit Transfer Service

Small NestJS API for moving money between Bankit accounts. Amounts are stored as PostgreSQL `DECIMAL` (not floats). Transfers run in one database transaction with `SELECT … FOR UPDATE` so two concurrent requests cannot overspend the same account.

## Setup

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npx prisma migrate dev
npx prisma db seed
npm run start:dev
```

The API listens on `http://localhost:3000`.

## Tests

Postgres must be running (`docker compose up -d postgres`).

```bash
npm run test:e2e
```

## Postman

Base URL: `http://localhost:3000`

Use **account** `id` values in transfers, not user ids. Easiest path:

1. `POST /users` — create Ada and Boli
2. `POST /accounts` — open an account for each (`userId`, `balance`, `currency`)
3. Copy each account `id`
4. `POST /transfers` with those account ids

Or seed and copy the printed account ids from the terminal / Prisma Studio **Account** table.

## API

### Users

`POST /users`

```json
{
  "name": "Ada Okonkwo",
  "email": "ada@bankit.test"
}
```

`GET /users`  
`GET /users/:userId`

### Accounts

`POST /accounts`

```json
{
  "userId": "<user-uuid>",
  "balance": 100000,
  "currency": "NGN"
}
```

`GET /accounts`  
`GET /accounts/:accountId`  
`GET /accounts/:accountId/balance`  
`GET /accounts/:accountId/transactions?page=1&limit=20`

### Transfers

`POST /transfers`

```json
{
  "senderAccountId": "<account-uuid>",
  "recipientAccountId": "<account-uuid>",
  "amount": 20000
}
```

Optional header: `Idempotency-Key: abc123`

Success (`201`):

```json
{
  "success": true,
  "reference": "TRX-…",
  "status": "SUCCESS"
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient account balance"
  }
}
```

Codes: `INVALID_REQUEST`, `ACCOUNT_NOT_FOUND`, `INSUFFICIENT_FUNDS`, `CURRENCY_MISMATCH`, `DUPLICATE_REQUEST`, `TRANSFER_FAILED`.

`GET /transfers/:reference` returns the stored transfer.

## Assumptions

- Amounts are major currency units (₦20,000 is `20000`), stored as `DECIMAL(19,4)`.
- Account IDs are UUIDs. Transfers use `accounts.id`, not `users.id`.
- No auth. The challenge asked not to spend time on it.
- Failed transfers are not persisted. A unique `TRX-…` reference is stored for successful transfers. Retries with the same `Idempotency-Key` return the original success payload and do not debit again.

## How a transfer is applied

Inside one Postgres transaction:

1. Claim the idempotency key (unique row) if the header is present.
2. Lock both accounts with `SELECT … FOR UPDATE`, always in ID order to avoid deadlocks.
3. Reject missing accounts, currency mismatch, or insufficient funds.
4. Debit, credit, insert the transaction row, save the idempotency response.
5. Commit. Any thrown error rolls the whole unit back.
