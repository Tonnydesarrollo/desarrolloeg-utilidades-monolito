import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

const jar = new CookieJar();

const client = wrapper(axios.create({
  baseURL: process.env.FACTURAS_CLUBFACTURA_BASE,
  withCredentials: true,
  jar,
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Content-Type': 'application/json',
    'Origin': 'https://www.clubfactura.mx',
    'Referer': 'https://www.clubfactura.mx/cfAppN/account/login'
  }
}));

export { client, jar };
