#!/bin/bash

# 顏色定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 自動定位專案根目錄
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${YELLOW}進入專案根目錄: ${PROJECT_ROOT}${NC}"
cd "$PROJECT_ROOT"

echo -e "${YELLOW}開始檢查 package-lock.json 狀態...${NC}"

# 檢查函數
check_and_install() {
    local dir=$1
    echo -e "${YELLOW}檢查目錄: ${dir}${NC}"
    
    if [ ! -f "${dir}/package-lock.json" ]; then
        echo -e "${RED}[!] 缺少 package-lock.json，正在為 ${dir} 生成...${NC}"
        (cd "${dir}" && npm install)
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}[V] ${dir} 鎖定檔已生成成功。${NC}"
        else
            echo -e "${RED}[X] ${dir} npm install 失敗，請檢查網路或 package.json 配置。${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}[V] ${dir}/package-lock.json 已存在。${NC}"
    fi
}

# 1. 檢查根目錄
check_and_install "."

# 2. 檢查 web-dashboard 目錄
if [ -d "web-dashboard" ]; then
    check_and_install "web-dashboard"
else
    echo -e "${YELLOW}[!] 未發現 web-dashboard 目錄，跳過。${NC}"
fi

echo -e "${GREEN}所有依賴鎖定檔檢查完畢！準備重構 Docker 鏡像...${NC}"

# 3. 執行 Docker 重構
echo -e "${YELLOW}執行: docker compose build --no-cache${NC}"
docker compose build --no-cache

if [ $? -eq 0 ]; then
    echo -e "${GREEN}恭喜！Docker 鏡像重構完成。${NC}"
else
    echo -e "${RED}Docker 重構過程中出現錯誤。${NC}"
    exit 1
fi
