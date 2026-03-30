import { client } from '../config/axios.js';

export async function loginClubFactura() {
  const response = await client.post('/api/auth/login', {
    userName: process.env.FACTURAS_CLUBFACTURA_USER,
    password: process.env.FACTURAS_CLUBFACTURA_PASSWORD
  });

  const token = response.data?.token;
  if (!token) throw new Error('No se recibio token de ClubFactura');
  client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  return token;
}
