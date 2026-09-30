# Console or frontend integration

Create a game with a fresh UUID request key. Keep the key private and reuse it only when retrying the exact request.

```http
POST /games
Content-Type: application/json
Idempotency-Key: 381f506c-559b-407d-a7e3-a0a8d2b9bc46

{
  "prompt": "Alex Curtiss shared a story about a customer who contacted Security after the employee who owned their account left the company. Because the account was tied to that employee’s email address, it effectively left with them. Security then had to do some sleuthing to identify the rightful new owner and transfer the account."
}
```

The response contains `game` and `session_token`. Store both locally. Render the opening transcript entry, objective, location, visible entities, stage, and ending.

```http
POST /games/{returned_game_id}/turns
Authorization: Bearer {returned_session_token}
Content-Type: application/json
Idempotency-Key: 8ac797b4-ae77-41b0-83c4-310c0e603e66

{"text":"look around","expected_version":0}
```

Use the returned version on the next request. Rejected and clarification outcomes are normal `200` responses and still advance the version.

On refresh, call `GET /games/{id}` with the bearer token. On a `409 stale_state`, fetch the game before accepting another command. On network failure or `503`, preserve the same request key and exact body for retry; never invent a new key for an uncertain result.

When `status` becomes `completed`, stop accepting commands and display the earned ending. A new game created from the same prompt can have a different world and branches.
