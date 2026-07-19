from datasets import load_dataset
from torchvision import transforms
from torch.utils.data import DataLoader
import torch
import torch.nn as nn
import torch.optim as optim
import torch.nn.functional as F
import numpy as np


class LeNet(nn.Module):
    def __init__(self):
        super(LeNet, self).__init__()
        self.conv1 = nn.Conv2d(1, 6, kernel_size=5, stride=1, padding=0)
        self.relu1 = nn.ReLU()
        self.pool1 = nn.MaxPool2d(kernel_size=2, stride=2)

        self.conv2 = nn.Conv2d(6, 16, kernel_size=5, stride=1, padding=0)
        self.relu2 = nn.ReLU()
        self.pool2 = nn.MaxPool2d(kernel_size=2, stride=2)

        self.fc1 = nn.Linear(256, 120)
        self.relu3 = nn.ReLU()
        self.fc2 = nn.Linear(120, 84)
        self.relu4 = nn.ReLU()
        self.fc3 = nn.Linear(84, 10)

    def forward(self, x):
        y = self.conv1(x)
        y = self.relu1(y)
        y = self.pool1(y)

        y = self.conv2(y)
        y = self.relu2(y)
        y = self.pool2(y)

        y = y.view(y.shape[0], -1)

        y = self.fc1(y)
        y = self.relu3(y)

        y = self.fc2(y)
        y = self.relu4(y)

        y = self.fc3(y)
        return y


def train(model, device, train_loader, optimizer, epoch):
    model.train()
    for batch_idx, batch in enumerate(train_loader, 0):
        data, target = batch["image"].to(device), batch["label"].to(device)
        optimizer.zero_grad()
        output = model(data.float())
        loss = F.cross_entropy(output, target.long())
        loss.backward()
        optimizer.step()
        if batch_idx % 100 == 0:
            print(
                f"Train Epoch: {epoch} [{batch_idx * len(data)}/{len(train_loader.dataset)} ({100. * batch_idx / len(train_loader):.0f}%)]\tLoss: {loss.item():.6f}"
            )


if __name__ == "__main__":
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = LeNet().to(device)
    optimizer = optim.Adam(model.parameters(), lr=2e-3)

    dataset = load_dataset("ylecun/mnist")
    transform = transforms.Compose(
        [
            transforms.ToTensor(),
            transforms.Resize((32, 32)),
            transforms.Normalize(mean=(0.1307,), std=(0.3081,)),  # MNIST mean and std
        ]
    )
    train_dataset = dataset["train"]
    train_dataset.set_format(type="torch")

    def transform_example(example):
        # Convert to PIL Image to apply torchvision transforms
        # img = Image.fromarray(example["image"].astype(np.uint8))
        img = example["image"].numpy()
        return {"image": transform(img), "label": example["label"]}

    train_dataset.map(transform_example)
    test_dataset = dataset["test"]
    test_dataset.set_format(type="torch")
    test_dataset.map(transform_example)

    # Data loaders
    train_loader = DataLoader(train_dataset, batch_size=256, shuffle=True)
    test_loader = DataLoader(test_dataset, batch_size=1024, shuffle=False)

    for epoch in range(1, 15):
        train(model, device, train_loader, optimizer, epoch)

    with torch.no_grad():
        correct = 0
        total = 0
        for batch_idx, batch in enumerate(train_loader, 0):
            images, labels = batch["image"].to(device), batch["label"].to(device)
            outputs = model(images.float()).detach()
            predicted = torch.argmax(outputs.data, dim=-1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()

        print(
            "Accuracy of the network on the 10000 test images: {} %".format(
                100 * correct / total
            )
        )

    torch.save(model.state_dict(), "lenet_mnist_model.pth")
    print("Saved PyTorch Model State to lenet_mnist_model.pth")
