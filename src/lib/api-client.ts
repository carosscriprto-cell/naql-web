import axios from "axios";
import { env } from "@/config/env";

export const api = axios.create({ baseURL: env.NEXT_PUBLIC_API_URL });
