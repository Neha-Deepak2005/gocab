"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL, getToken } from "./api";

/** Connects to /ws/{role}/{id}, reconnects automatically, keeps alive with pings. */
export function useSocket(role: "rider" | "driver" | undefined, userId: number | undefined, onMessage: (msg: any) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!role || !userId) return;
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    let ping: ReturnType<typeof setInterval>;
    let attempts = 0;

    const connect = () => {
      const ws = new WebSocket(`${WS_URL}/ws/${role}/${userId}?token=${encodeURIComponent(getToken() || "")}`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
        ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "ping" })), 25000);
      };
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data));
        } catch {}
      };
      ws.onclose = (e) => {
        setConnected(false);
        clearInterval(ping);
        if (!stop && e.code !== 4401) retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000));
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(retry);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [role, userId]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(data));
  }, []);
  return { connected, send };
}
