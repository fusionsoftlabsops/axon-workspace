-- Rol Product Owner (Iris): refina el backlog (DoR) y acepta el cierre (DoD).
-- Aditivo: agrega el valor PO al enum AgentRole. Postgres permite ADD VALUE
-- fuera de transacción; Prisma migrate lo corre en su propia sentencia.
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'PO';
