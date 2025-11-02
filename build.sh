#打包
rm -rf yarn.lock
rm -rf node_modules
yarn install
yarn build


#把build目录复制到whiteboard-android/sdk/src/main/assets/whiteboard目录,替换原有文件，先删除
rm -rf ../whiteboard-android/sdk/src/main/assets/whiteboard/*
cp -r build/* ../whiteboard-android/sdk/src/main/assets/whiteboard/

#把build目录复制到Whiteboard-iOS/Whiteboard/Resource目录,替换原有文件，先删除
rm -rf ../Whiteboard-iOS/Whiteboard/Resource/*
cp -r build/* ../Whiteboard-iOS/Whiteboard/Resource/

#提交安卓git，切换到develop分支，提交并推送
cd ../whiteboard-android
git checkout develop
git pull
git add .
git commit -m "update whiteboard-bridge-veytu"
git push

#提交iOS git，切换到develop分支，提交并推送
cd ../Whiteboard-iOS
git checkout develop
git pull
git add .
git commit -m "update whiteboard-bridge-veytu"
git push


#提交whiteboard-bridge-veytu git，切换到develop分支，提交并推送
cd ../whiteboard-bridge-veytu
git add .
git commit -m "update whiteboard-bridge-veytu"
git push
