-- CreateTable
CREATE TABLE "issue_links" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "linkType" TEXT NOT NULL DEFAULT 'relates',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_links_sourceKey_idx" ON "issue_links"("sourceKey");

-- CreateIndex
CREATE INDEX "issue_links_targetKey_idx" ON "issue_links"("targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "issue_links_sourceKey_targetKey_linkType_key" ON "issue_links"("sourceKey", "targetKey", "linkType");
