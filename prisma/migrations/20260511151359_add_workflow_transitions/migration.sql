-- CreateTable
CREATE TABLE "workflow_transitions" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "fromStatusId" TEXT NOT NULL,
    "toStatusId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_transitions_spaceId_idx" ON "workflow_transitions"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transitions_spaceId_fromStatusId_toStatusId_key" ON "workflow_transitions"("spaceId", "fromStatusId", "toStatusId");

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_fromStatusId_fkey" FOREIGN KEY ("fromStatusId") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_toStatusId_fkey" FOREIGN KEY ("toStatusId") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
