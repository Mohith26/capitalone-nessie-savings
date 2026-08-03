import { describe, expect, it, vi } from "vitest";
import { NessieApiError, NessieClient } from "../src/nessie-client/client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("NessieClient retry behavior", () => {
  it("retries on transient 503s and succeeds once the mock recovers", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) return jsonResponse(503, { message: "transient" });
      return jsonResponse(201, { _id: "cust_1", first_name: "A", last_name: "B" });
    });

    const client = new NessieClient({
      baseUrl: "http://mock",
      apiKey: "k",
      baseDelayMs: 1,
      maxRetries: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const customer = await client.createCustomer({
      first_name: "A",
      last_name: "B",
      address: { street_number: "1", street_name: "Main", city: "X", state: "TX", zip: "00000" },
    });

    expect(customer._id).toBe("cust_1");
    expect(calls).toBe(3); // failed twice, succeeded on the 3rd attempt
  });

  it("gives up after maxRetries and throws NessieApiError with the final status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { message: "still broken" }));

    const client = new NessieClient({
      baseUrl: "http://mock",
      apiKey: "k",
      baseDelayMs: 1,
      maxRetries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.createCustomer({
        first_name: "A",
        last_name: "B",
        address: { street_number: "1", street_name: "Main", city: "X", state: "TX", zip: "00000" },
      }),
    ).rejects.toBeInstanceOf(NessieApiError);

    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it("does not retry on non-retryable 4xx errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { message: "not found" }));
    const client = new NessieClient({
      baseUrl: "http://mock",
      apiKey: "k",
      baseDelayMs: 1,
      maxRetries: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.getAccount("missing")).rejects.toBeInstanceOf(NessieApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
