# failure reports
\b(?:it\s+)?(?:is\s+)?(?:still\s+)?(?:doesn['’]?t|doesnt|don['’]?t|dont|didn['’]?t|didnt|not)\s+work(?:ing)?\b
\b(?:still|again)\s+(?:broken|failing|failed|wrong|not\s+implemented)\b
\b(?:not\s+working|isn['’]?t\s+working|wasn['’]?t\s+working)\b
\b(?:worse\s+now|made\s+it\s+worse|more\s+broken)\b
\b(?:hard\s+failures?|hard\s+failed)\b
\b(?:i\s+got|i\s+still\s+see|still\s+seeing|seeing)\s+(?:this\s+)?(?:error|failure)\b
\b(?:stopped\s+working|still\s+fails?|keeps?\s+failing)\b
\byou\s+broke\b
\bbroke\s+the\s+(?:build|tests?|app)\b
\b(?:caused|introduced|that['’]?s)\s+(?:a\s+)?regression\b

# correction and pushback
\b(?:annoying|frustrating|frustrated|terrible|awful)\b
\b(?:too|so)\s+(?:slow|confusing|messy|verbose|restrictive|weak)\b
\b(?:analyse|analyze)\s+it\s+properly\b
\bcome\s+up\s+with\s+a\s+proper\s+(?:design|plan|fix)\b
\bwhat\s+is\s+wrong\s+with\b
\b(?:what['’]?s|what\s+is)\s+(?:the\s+)?(?:problem|failure|error)\b
\b(?:too\s+aggressive|too\s+strict|too\s+loose)\b
\b(?:doesn['’]?t|doesnt)\s+make\s+sense\b
\b(?:not|isn['’]?t|wasn['’]?t)\s+(?:good\s+enough|clear\s+enough|clear|useful|acceptable|right)\b
\bnot\s+what\s+(?:I\s+)?asked\b
\b(?:you|u)\s+(?:didn['’]?t|didnt|did\s+not)\s+(?:follow|read|do|listen|rerun|test|check|implement)\b
\bI\s+told\s+(?:you|u)\b
\b(?:told|asked)\s+(?:you|u)\s+to\b
^\s*no[,]?\s+I\s+(?:mean|meant|want|wanted)\b
\bi\s+don['’]?t\s+want\b
^\s*no[,]?\s+(?:just|continue|restart|launch|make|use|allow|change|test|run)\b
\b(?:that['’]?s|this\s+is|it['’]?s|you(?:['’]?re| are)|still|completely)\s+(?:wrong|incorrect)\b
\b(?:wrong|incorrect)\s+again\b
\b(?:exact\s+)?same\s+(?:thing|result|error|output)\s+(?:again|as\s+before)\b
\b(?:same|another)\s+mistake\b
\byou\s+made\s+(?:a\s+|the\s+same\s+)?mistake\b
\bfor\s+the\s+(?:second|third|fourth|last|nth|hundredth)\s+time\b
\boriginal\s+(?:error|bug|issue)\s+is\s+still\s+there\b
\b(?:don['’]?t|dont|do\s+not)\s+just\b
\b(?:is\s+)?not\s+needed(?:\s+at\s+all)?\b
\bdoes\s+not\s+follow\b
\bwhy\s+did\s+.+\s+not\s+work\b
\b(?:like|as)\s+I\s+(?:said|told\s+you|mentioned|asked)\b
\byou\s+keep\s+(?:doing|making|breaking|ignoring|adding|removing)\b
\bwhy\s+(?:did|are|would|the\s+hell)\s+(?:you|u)\b
\bdid\s+I\s+ask\b
\bI\s+didn['’]?t\s+ask\s+for\b
\bmakes\s+no\s+sense\b

# steering and interrupts
\bwait\s+no\b
\bno[,]?\s+(?:don['’]?t|dont|do\s+not)\b
\b(?:do\s+not|don['’]?t|dont)\s+commit\b
\b(?:don['’]?t|dont|do\s+not)\s+change\s+anything\b
\bnever\s+mind\b
\b(?:undo|revert)\s+(?:that|this|it|your|the\s+(?:last|change|commit|edit))\b
\b(?:pause|cancel|stop)\s+(?:that|this|now|it)\b
\bseriously\?+
\bno\s+no\s+no\b
\bnot\s+again\b
